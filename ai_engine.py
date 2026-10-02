import os
import concurrent.futures
from typing import TypedDict, List, Literal, Any
from dotenv import load_dotenv
from pathlib import Path

from langchain.messages import SystemMessage, HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from googleapiclient.discovery import build
from langgraph.graph import StateGraph, START, END
from pydantic import BaseModel
from tavily import TavilyClient

# Load environment variables
project_root = Path(__file__).resolve().parent
load_dotenv(project_root / ".env")
load_dotenv(project_root / "Backend" / ".env")

# Initialize Clients
model = ChatGoogleGenerativeAI(
    model="gemini-3.6-flash",
    api_key=os.getenv("GEMINI_API_KEY"),
    temperature=0
)

tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")
if YOUTUBE_API_KEY:
    youtube_client = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)
else:
    youtube_client = None
    print("[WARNING] YOUTUBE_API_KEY is not set. YouTube search will return fallback links.")

# ==========================================
# STATE & MODELS
# ==========================================

class SubjectState(TypedDict):
    topic: str
    previous_score: str
    knowledge_level: str
    goal: str
    roadmap: dict[str, Any]
    quiz: dict[str, Any]
    flashcards: dict[str, Any]

class Topic(BaseModel):
    name: str
    difficulty: Literal["High", "Medium", "Low"]
    definition: str
    Links: str
    articles: List[str]

class Subtopic(BaseModel):
    subtopic_name: str
    difficulty: Literal["High", "Medium", "Low"]
    definition: str
    topics: List[Topic]

class MindMap(BaseModel):
    topic_name: str
    definition: str
    subtopics: List[Subtopic]

struct_model = model.with_structured_output(MindMap)

class Question(BaseModel):
    question: str
    options: List[str]
    correct_answer: str
    explanation: str

class SubtopicQuiz(BaseModel):
    subtopic_name: str
    questions: List[Question]

class Quiz(BaseModel):
    questions: List[Question]
    subtopic_quizzes: List[SubtopicQuiz] = []

quiz_struct_model = model.with_structured_output(Quiz)

class Flashcard(BaseModel):
    front: str
    back: str

class FlashcardDeck(BaseModel):
    cards: List[Flashcard]

flashcard_struct_model = model.with_structured_output(FlashcardDeck)

# ==========================================
# PROMPTS
# ==========================================

prompt = """You are an expert learning-roadmap generator.

Your task is to create a structured learning roadmap for any topic provided by the user.

The roadmap must organize the topic from foundational concepts to advanced concepts and should help a learner understand what they should learn and in what order.

Follow these rules:

1. Identify the major subtopics required to understand the given topic.
2. Arrange the subtopics in a logical learning sequence, generally from foundational concepts to advanced concepts.
3. For every subtopic:
   - Provide a clear subtopic name.
   - Assign a difficulty level: "Low", "Medium", or "High".
   - Give a moderate amount of description about the topic
   - Identify the important concepts/topics that should be learned within that subtopic.
4. For every topic inside a subtopic:
   - Provide a concise and meaningful topic name.
   - Give a moderate amount of description about the topic
   - Assign a difficulty level: "Low", "Medium", or "High".
   - generate a youtube video link for the topic (give only the links for the youtube videos that exists don't try to make up links else write focus on articles)
   - 2-3 articles for the topic
5. Include prerequisite concepts before concepts that depend on them.
6. Do not include unnecessary or highly specialized concepts unless they are important for understanding the topic.
7. The roadmap should be comprehensive enough for a learner to progress from beginner to advanced level.
8. Avoid duplicate topics.
9. Difficulty should represent the relative complexity of learning the concept, not its importance.
10. The number of subtopics and topics should depend on the complexity of the input topic. Do not use a fixed number.
11. Return only the structured output defined by the provided schema. Do not return explanations, Markdown, comments, or additional text.

The input will be a topic that the user wants to learn.

return only in json format

not any other format

Generate the learning roadmap for that topic."""

quiz_prompt = """You are an expert quiz generator.
Generate a multiple-choice quiz for the topic provided by the user.
Generate 5 general questions for the main topic.
Additionally, generate 3 specific questions for EACH of the subtopics listed in the roadmap.

For each question:
- Provide the question text.
- Provide 4 options.
- Specify the exact correct answer (must match one of the options).
- Provide a short explanation of why the answer is correct."""

flashcard_prompt = """You are an expert Spaced Repetition System (SRS) content creator.
Generate a deck of flashcards for the topic provided by the user.
Generate 10 high-yield flashcards covering the most important concepts, definitions, and facts.

For each flashcard:
- Provide the 'front' of the card (a clear, concise question or term).
- Provide the 'back' of the card (a clear, accurate, and easily digestible answer or definition)."""

# ==========================================
# SEARCH FUNCTIONS
# ==========================================

def search_articles(query: str, max_results: int = 3) -> List[str]:
    try:
        response = tavily_client.search(
            query=f"{query} tutorial explanation",
            search_depth="basic",
            max_results=max_results,
        )
        return [r["url"] for r in response.get("results", [])]
    except Exception as e:
        print(f"Article search failed for '{query}': {e}")
        return []

def search_best_youtube_video(query: str) -> str:
    if not youtube_client:
        return "focus on articles"
    try:
        request = youtube_client.search().list(
            q=query,
            part="snippet",
            type="video",
            maxResults=1,
            relevanceLanguage="en",
            safeSearch="strict",
            order="relevance",
        )
        response = request.execute()
        items = response.get("items", [])
        if items:
            video_id = items[0]["id"]["videoId"]
            return f"https://www.youtube.com/watch?v={video_id}"
        return "focus on articles"
    except Exception as e:
        print(f"YouTube search failed for '{query}': {e}")
        return "focus on articles"

# ==========================================
# GRAPH NODES
# ==========================================

def roadmapnode(state: SubjectState):
    dynamic_prompt = prompt

    k_level = state.get("knowledge_level")
    goal = state.get("goal")

    if k_level or goal:
        dynamic_prompt += "\n\nAdditional Context:\n"
        if k_level:
            dynamic_prompt += f"- The user's current knowledge level is: {k_level}. Tailor the depth of the roadmap accordingly.\n"
        if goal:
            dynamic_prompt += f"- The user's learning goal is: {goal}. Focus the topics to specifically help them achieve this goal.\n"

    sysquery = SystemMessage(content=dynamic_prompt)
    humquery = HumanMessage(content=state["topic"])
    query = [sysquery, humquery]

    response = struct_model.invoke(query)
    roadmap = response.model_dump()
    return {"roadmap": roadmap}

def quiznode(state: SubjectState):
    dynamic_prompt = quiz_prompt
    
    # In-Context Progressive Quiz Logic
    prev_score_str = state.get("previous_score")
    if prev_score_str:
        dynamic_prompt += f"\n\nContext: The user scored {prev_score_str} on their previous quiz related to this topic. "
        dynamic_prompt += "If the score is low (e.g., under 50%), generate an easier, foundational-level quiz. "
        dynamic_prompt += "If the score is high (e.g., over 80%), generate a highly advanced, challenging quiz to push their limits."

    roadmap = state.get("roadmap", {})
    subtopics = [sub.get("subtopic_name", "") for sub in roadmap.get("subtopics", [])]
    if subtopics:
        dynamic_prompt += "\n\nThe roadmap includes the following subtopics:\n" + "\n".join([f"- {s}" for s in subtopics])

    sysquery = SystemMessage(content=dynamic_prompt)
    humquery = HumanMessage(content=state["topic"])
    query = [sysquery, humquery]

    response = quiz_struct_model.invoke(query)
    quiz = response.model_dump()
    return {"quiz": quiz}

def flashcardnode(state: SubjectState):
    sysquery = SystemMessage(content=flashcard_prompt)
    humquery = HumanMessage(content=state["topic"])
    query = [sysquery, humquery]

    response = flashcard_struct_model.invoke(query)
    flashcards = response.model_dump()
    return {"flashcards": flashcards}

def fast_youtube_node(state: SubjectState):
    roadmap = state["roadmap"]
    topics = []
    for sub in roadmap.get("subtopics", []):
        for t in sub.get("topics", []):
            topics.append(t)

    def fetch_yt(t):
        try:
            q = f"{t.get('name', '')} tutorial"
            t["Links"] = search_best_youtube_video(q)
        except Exception:
            t["Links"] = "focus on articles"

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(fetch_yt, topics))

    return {"roadmap": roadmap}

def fast_article_node(state: SubjectState):
    roadmap = state["roadmap"]
    pairs = []
    for sub in roadmap.get("subtopics", []):
        for t in sub.get("topics", []):
            pairs.append((t, sub.get("subtopic_name", "")))

    def fetch_art(pair):
        t, sub_name = pair
        try:
            q = f"{t.get('name', '')} {sub_name}".strip()
            t["articles"] = search_articles(q, max_results=2)
        except Exception:
            t["articles"] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(fetch_art, pairs))

    return {"roadmap": roadmap}

# ==========================================
# WORKFLOW COMPILATION
# ==========================================

def build_workflow():
    graph = StateGraph(SubjectState)
    graph.add_node("roadmap", roadmapnode)
    graph.add_node("youtube", fast_youtube_node)
    graph.add_node("article", fast_article_node)
    graph.add_node("flashcards", flashcardnode)
    graph.add_node("quiz", quiznode)

    graph.add_edge(START, "roadmap")
    graph.add_edge("roadmap", "youtube")
    graph.add_edge("youtube", "article")
    graph.add_edge("article", "flashcards")
    graph.add_edge("flashcards", "quiz")
    graph.add_edge("quiz", END)

    return graph.compile()

