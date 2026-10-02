# LearnXYZ

LearnXYZ is an AI-powered learning platform that helps users learn any topic by generating a structured learning roadmap and providing relevant learning resources.

The platform takes a topic from the user and breaks it down into a logical sequence of subtopics and concepts, making it easier for the user to understand what they should learn and in what order.

## Project Goal

The platform provides:

* Learning roadmap for any topic
* Important subtopics and concepts
* Difficulty levels for concepts
* YouTube videos related to each topic
* Relevant articles/resources
* Quizzes to measure learning progress
* User dashboard containing previously searched topics
* Progress tracking

## Architecture

LearnXYZ has evolved into a full-stack application composed of three main services:

1. **Frontend (React/Vite)**
   - Interactive user interface built with React, Vite, and `@xyflow/react` for rendering mindmap-style roadmaps.
   - User authentication and dashboard views to track progress.

2. **Backend (Node.js/Express)**
   - REST API connecting the frontend to the database and the AI generation engine.
   - Uses MongoDB (Mongoose) for persistent storage of users, roadmaps, and progress (replacing the old `module.json` file storage).
   - Handles user authentication (JWT/bcrypt).

3. **AI Engine (Python/FastAPI)**
   - A persistent FastAPI server that orchestrates the LangGraph workflow, encapsulated in modular Python files (`ai_engine.py`).
   - Features parallelized node execution for YouTube and Article retrieval to reduce network latency.
   - Implements distributed caching using **Redis** to store and instantly return previously generated roadmaps, saving on LLM costs and ensuring scalability.

## LangGraph Workflow

LangGraph orchestrates the different stages of roadmap generation.

```text
START
  ↓
Roadmap Node (Generates Subtopics & Concepts tailored to user's knowledge level and goal)
  ↓
YouTube Node (Parallelized search for video resources)
  ↓
Article Node (Parallelized search for text resources)
  ↓
Flashcard Node (Generates Spaced Repetition flashcards)
  ↓
Quiz Node (Generates MCQ assessments dynamically scaled based on previous scores)
  ↓
END
```

The roadmap acts as the central object progressively enriched by the other nodes in the state.

## Responsibilities of Each Node

### Roadmap Node
* Understanding the user's topic, current knowledge level, and learning goal
* Creating a tailored learning structure (Foundations → Intermediate → Advanced)
* Generating concepts, assigning difficulty, and providing definitions

### YouTube Node
* Optimized parallel searching for relevant videos
* Adding video information (URLs) to the roadmap

### Article Node
* Optimized parallel searching for educational articles
* Adding article URLs to the roadmap

### Flashcard Node
* Generating high-yield Q&A flashcards for Spaced Repetition Systems (SRS)
* Highlighting key definitions and critical facts

### Quiz Node
* Generating a multiple-choice quiz based on the overall topic, as well as unique, specific quizzes for EACH subtopic.
* Scaling difficulty automatically based on the user's past quiz scores (Progressive Quizzes)
* Providing options, answers, and explanations

## Development Status

| Component                  | Status            |
| -------------------------- | ----------------- |
| User topic input           | Completed         |
| Personalized Learning Path | Completed         |
| Roadmap generation         | Completed         |
| Pydantic roadmap structure | Completed         |
| LangGraph workflow         | Completed         |
| Database storage (MongoDB) | Completed         |
| YouTube node               | Completed         |
| Article node               | Completed         |
| Flashcard generation       | Completed         |
| Progressive Quiz generation| Completed         |
| React Frontend & Visuals   | Completed         |
| Progress tracking          | Completed/Ongoing |
| Dashboard                  | Completed/Ongoing |

## Getting Started

*(Ensure you have configured your `.env` variables for MongoDB, API keys, etc.)*

1. **Start the AI Engine:**
   *(Ensure you have a local Redis server running on port 6379 for caching)*
   ```bash
   cd Backend
   npm run fastapi
   ```
2. **Start the Node Backend:**
   ```bash
   cd Backend
   npm run dev
   ```
3. **Start the Frontend:**
   ```bash
   cd Frontend
   npm run dev
   ```
