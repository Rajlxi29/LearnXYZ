import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Roadmap from "../model/Roadmap.js";
import Progress from "../model/Progress.js";
import User from "../model/User.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

// Helper to extract YouTube video ID from URL
function extractYouTubeId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/
  );
  return match ? match[1] : null;
}

// Helper to generate a URL-friendly slug
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-");
}

// Convert test.ipynb pipeline response into the schema expected by Frontend
function formatNotebookRoadmap(notebookData, requestedTopic) {
  const roadmapRaw = notebookData.roadmap || {};
  const quizRaw = notebookData.quiz || {};

  const title = roadmapRaw.topic_name || requestedTopic;
  const slug = slugify(title);
  const description =
    roadmapRaw.definition || `Structured learning roadmap for ${title}`;
  const subtopicsRaw = roadmapRaw.subtopics || roadmapRaw.sutopics || [];

  let totalItemsCount = 0;

  const nodes = subtopicsRaw.map((sub, sIdx) => {
    const nodeId = `${slug}-section-${sIdx + 1}`;
    const topicsList = sub.topics || [];

    const subtopics = topicsList.map((t, tIdx) => {
      const subtopicId = `${nodeId}-topic-${tIdx + 1}`;
      const ytId = extractYouTubeId(t.Links);

      const items = [
        {
          id: `${subtopicId}-concept`,
          title: `Core: ${t.name}`,
          status: "not-started",
        },
        {
          id: `${subtopicId}-deepdive`,
          title: `Deep-Dive & Practical Notes`,
          status: "not-started",
        },
      ];

      totalItemsCount += items.length + 1;

      return {
        id: subtopicId,
        title: t.name,
        definition: t.definition || "",
        difficulty: t.difficulty || "Medium",
        status: "not-started",
        video: {
          url: t.Links || "",
          youtubeId: ytId || "rfscVS0vtbw",
          title: `${t.name} Tutorial`,
          channel: "LearnXYZ Curated Lecture",
          duration: "18:24",
          thumbnail: ytId
            ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
            : "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=80",
        },
        articles: (t.articles || []).map((url, aIdx) => ({
          title: `${t.name} Resource ${aIdx + 1}`,
          url,
          source: url.includes("wikipedia")
            ? "Wikipedia"
            : url.includes("britannica")
            ? "Britannica"
            : "Reference Guide",
        })),
        items,
      };
    });

    totalItemsCount += 1;

    const stQuiz = (quizRaw.subtopic_quizzes || []).find(sq => sq.subtopic_name === sub.subtopic_name);
    let nodeQuiz = null;
    if (stQuiz && stQuiz.questions) {
      nodeQuiz = {
        id: `${nodeId}-quiz`,
        title: `${sub.subtopic_name} Quiz`,
        topicId: nodeId,
        timePerQuestion: 30,
        questions: stQuiz.questions.map((q, idx) => {
          const correctIndex = q.options ? q.options.indexOf(q.correct_answer) : 0;
          return {
            id: `q-${idx + 1}`,
            question: q.question,
            options: q.options || [],
            correctIndex: correctIndex >= 0 ? correctIndex : 0,
            correctAnswer: q.correct_answer,
            explanation: q.explanation || "",
          };
        })
      };
    }

    return {
      id: nodeId,
      title: sub.subtopic_name,
      definition: sub.definition || "",
      difficulty: sub.difficulty || "Medium",
      status: "not-started",
      order: sIdx + 1,
      subtopics,
      quiz: nodeQuiz,
    };
  });

  // Convert quiz questions to Frontend format
  const rawQuestions = quizRaw.questions || [];
  const questions = rawQuestions.map((q, idx) => {
    const correctIndex = q.options ? q.options.indexOf(q.correct_answer) : 0;
    return {
      id: `q-${idx + 1}`,
      question: q.question,
      options: q.options || [],
      correctIndex: correctIndex >= 0 ? correctIndex : 0,
      correctAnswer: q.correct_answer,
      explanation: q.explanation || "",
    };
  });

  const quiz = {
    id: `${slug}-quiz`,
    title: `${title} Section Mastery Quiz`,
    topicId: slug,
    timePerQuestion: 30,
    questions,
  };

  return {
    slug,
    title,
    description,
    category: "Specialized Curriculum",
    difficulty: "Intermediate",
    estimatedHours: Math.max(25, nodes.length * 15),
    totalTopics: totalItemsCount,
    nodes,
    quiz,
    rawResponse: notebookData,
  };
}

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

// Call the FastAPI service running test.ipynb's LangGraph pipeline
async function fetchRoadmapFromFastAPI(topic) {
  try {
    const response = await fetch(`${FASTAPI_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`FastAPI error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    if (err.cause?.code === "ECONNREFUSED" || err.message.includes("fetch failed")) {
      throw new Error(
        `FastAPI service is not running on ${FASTAPI_URL}. Start it by running: python fastapi_app.py`
      );
    }
    throw err;
  }
}

// ─── API Controllers ─────────────────────────────────────────────────────────

// POST /api/roadmaps/generate
// Receives topic, calls FastAPI endpoint running test.ipynb, takes response through Express,
// stores in MongoDB, and initializes user progress.
export const generateRoadmap = async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic || !topic.trim()) {
      return res.status(400).json({ message: "Topic name is required." });
    }

    const cleanTopic = topic.trim();
    const potentialSlug = slugify(cleanTopic);

    // 1. Check if already built and saved in MongoDB
    let roadmap = await Roadmap.findOne({
      $or: [
        { slug: potentialSlug },
        { title: new RegExp(`^${cleanTopic}$`, "i") },
      ],
    });

    // 2. If new roadmap request, call FastAPI and take response directly
    if (!roadmap) {
      console.log(`Generating new roadmap for "${cleanTopic}" via FastAPI service...`);
      const notebookResponse = await fetchRoadmapFromFastAPI(cleanTopic);


      if (!notebookResponse || !notebookResponse.roadmap) {
        return res.status(500).json({
          message: "No roadmap structure was returned by test.ipynb.",
        });
      }

      // Format response and save into MongoDB
      const formatted = formatNotebookRoadmap(notebookResponse, cleanTopic);
      if (req.user) {
        formatted.userId = req.user._id;
      }

      roadmap = await Roadmap.create(formatted);
      console.log(`New roadmap successfully built and saved: "${roadmap.title}" (${roadmap.slug})`);
    }

    // 3. Setup progress record for the user
    let progress = null;
    if (req.user) {
      progress = await Progress.findOne({
        userId: req.user._id,
        roadmapId: roadmap._id,
      });

      if (!progress) {
        progress = await Progress.create({
          userId: req.user._id,
          roadmapId: roadmap._id,
          roadmapSlug: roadmap.slug,
          topicProgress: {},
          totalCount: roadmap.totalTopics || 20,
          completedCount: 0,
          progressPercentage: 0,
        });
      }
    }

    res.status(200).json({
      success: true,
      roadmap,
      progress,
    });
  } catch (error) {
    console.error("generateRoadmap error:", error);
    res.status(500).json({ message: error.message || "Failed to build roadmap." });
  }
};

// GET /api/roadmaps
export const getAllRoadmaps = async (req, res) => {
  try {
    const roadmaps = await Roadmap.find().sort({ createdAt: -1 }).lean();

    let userProgressMap = {};
    if (req.user) {
      const progressList = await Progress.find({ userId: req.user._id }).lean();
      progressList.forEach((p) => {
        userProgressMap[p.roadmapId.toString()] = p;
      });
    }

    const enriched = roadmaps.map((r) => {
      const p = userProgressMap[r._id.toString()];
      return {
        ...r,
        progress: p ? p.progressPercentage : 0,
        completedCount: p ? p.completedCount : 0,
      };
    });

    res.status(200).json(enriched);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/roadmaps/:id
export const getRoadmapById = async (req, res) => {
  try {
    const { id } = req.params;

    const roadmap = await Roadmap.findOne({
      $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { slug: id }],
    }).lean();

    if (!roadmap) {
      return res.status(404).json({ message: "Roadmap not found" });
    }

    // Attach user's progress status to nodes
    let userProgress = null;
    if (req.user) {
      userProgress = await Progress.findOne({
        userId: req.user._id,
        roadmapId: roadmap._id,
      }).lean();

      if (userProgress && userProgress.topicProgress) {
        const tp = userProgress.topicProgress;
        roadmap.nodes = (roadmap.nodes || []).map((node) => {
          const nodeStatus = tp[node.id] || "not-started";
          const subtopics = (node.subtopics || []).map((sub) => {
            const subStatus = tp[sub.id] || "not-started";
            const items = (sub.items || []).map((item) => ({
              ...item,
              status: tp[item.id] || "not-started",
            }));
            return {
              ...sub,
              status: subStatus,
              items,
            };
          });

          return {
            ...node,
            status: nodeStatus,
            subtopics,
          };
        });
      }
    }

    res.status(200).json({
      ...roadmap,
      userProgress,
      overallProgress: userProgress ? userProgress.progressPercentage : 0,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/roadmaps/:id/progress
// Tracks user completion progress for each topic / subtopic in MongoDB
export const updateProgress = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Must be logged in to track progress." });
    }

    const { id } = req.params;
    const { itemId, status } = req.body;

    if (!itemId || !status) {
      return res.status(400).json({ message: "itemId and status are required." });
    }

    const roadmap = await Roadmap.findOne({
      $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { slug: id }],
    });

    if (!roadmap) {
      return res.status(404).json({ message: "Roadmap not found" });
    }

    let progress = await Progress.findOne({
      userId: req.user._id,
      roadmapId: roadmap._id,
    });

    if (!progress) {
      progress = new Progress({
        userId: req.user._id,
        roadmapId: roadmap._id,
        roadmapSlug: roadmap.slug,
        topicProgress: new Map(),
        totalCount: roadmap.totalTopics || 20,
      });
    }

    progress.topicProgress.set(itemId, status);

    // Count completed items
    let completed = 0;
    for (const [k, val] of progress.topicProgress.entries()) {
      if (val === "completed") completed++;
    }

    const total = Math.max(roadmap.totalTopics || 1, progress.totalCount || 1, completed);
    progress.completedCount = completed;
    progress.progressPercentage = Math.min(100, Math.round((completed / total) * 100));
    progress.lastAccessedAt = new Date();

    await progress.save();

    // Update user stats in User document
    const allUserProgress = await Progress.find({ userId: req.user._id });
    const totalCompletedAcrossAll = allUserProgress.reduce(
      (sum, p) => sum + (p.completedCount || 0),
      0
    );
    await User.findByIdAndUpdate(req.user._id, {
      totalTopicsCompleted: totalCompletedAcrossAll,
    });

    res.status(200).json({
      success: true,
      progressPercentage: progress.progressPercentage,
      completedCount: progress.completedCount,
      topicProgress: Object.fromEntries(progress.topicProgress),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/roadmaps/:id/quiz
export const getRoadmapQuiz = async (req, res) => {
  try {
    const { id } = req.params;
    const roadmap = await Roadmap.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { slug: id },
        { "nodes.id": id },
        { "nodes.subtopics.id": id },
      ],
    }).lean();

    if (!roadmap) {
      return res.status(404).json({ message: "Quiz not found for this roadmap." });
    }

    let targetQuiz = roadmap.quiz;
    if (roadmap.slug !== id && (!roadmap._id || roadmap._id.toString() !== id)) {
      // Find the specific node or subtopic that matches id
      const node = roadmap.nodes.find(n => n.id === id || (n.subtopics && n.subtopics.some(s => s.id === id)));
      if (node && node.quiz) {
        targetQuiz = node.quiz;
      }
    }

    if (!targetQuiz) {
      return res.status(404).json({ message: "Quiz not found." });
    }

    res.status(200).json(targetQuiz);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/roadmaps/:id/quiz/submit
export const submitQuiz = async (req, res) => {
  try {
    const { id } = req.params;
    const { answers } = req.body;

    const roadmap = await Roadmap.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { slug: id },
        { "nodes.id": id },
        { "nodes.subtopics.id": id },
      ],
    });

    if (!roadmap) {
      return res.status(404).json({ message: "Quiz not found." });
    }
    
    let targetQuiz = roadmap.quiz;
    if (roadmap.slug !== id && (!roadmap._id || roadmap._id.toString() !== id)) {
      const node = roadmap.nodes.find(n => n.id === id || (n.subtopics && n.subtopics.some(s => s.id === id)));
      if (node && node.quiz) {
        targetQuiz = node.quiz;
      }
    }

    if (!targetQuiz || !targetQuiz.questions) {
      return res.status(404).json({ message: "Quiz not found." });
    }

    const questions = targetQuiz.questions;
    let correctCount = 0;

    questions.forEach((q, idx) => {
      if (answers && answers[idx] === q.correctIndex) {
        correctCount++;
      }
    });

    const score = Math.round((correctCount / questions.length) * 100);
    const passed = score >= 60;

    if (req.user) {
      let progress = await Progress.findOne({
        userId: req.user._id,
        roadmapId: roadmap._id,
      });

      if (!progress) {
        progress = new Progress({
          userId: req.user._id,
          roadmapId: roadmap._id,
          roadmapSlug: roadmap.slug,
          topicProgress: new Map(),
        });
      }

      progress.quizScores.push({
        quizId: roadmap.quiz.id || `${roadmap.slug}-quiz`,
        score,
        correctCount,
        totalQuestions: questions.length,
        passed,
        takenAt: new Date(),
      });

      await progress.save();

      // Recalculate average user quiz score
      const allUserProgress = await Progress.find({ userId: req.user._id });
      let allScores = [];
      allUserProgress.forEach((p) => {
        (p.quizScores || []).forEach((qs) => allScores.push(qs.score));
      });

      if (allScores.length > 0) {
        const avgScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);
        await User.findByIdAndUpdate(req.user._id, { averageQuizScore: avgScore });
      }
    }

    res.status(200).json({
      success: true,
      score,
      correctCount,
      totalQuestions: questions.length,
      passed,
      quiz: roadmap.quiz,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/roadmaps/user/dashboard-summary
export const getDashboardSummary = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const user = await User.findById(req.user._id).select("-password").lean();
    const progressList = await Progress.find({ userId: req.user._id })
      .populate("roadmapId")
      .sort({ lastAccessedAt: -1 })
      .lean();

    const syllabi = progressList
      .filter((p) => p.roadmapId)
      .map((p) => ({
        id: p.roadmapId.slug || p.roadmapId._id,
        title: p.roadmapId.title,
        uploadedAt: p.createdAt ? p.createdAt.toISOString().split("T")[0] : "2026-08-10",
        progress: p.progressPercentage || 0,
        completedCount: p.completedCount || 0,
        totalTopics: p.totalCount || p.roadmapId.totalTopics || 20,
      }));

    res.status(200).json({
      user,
      syllabi,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/roadmaps/:id
export const deleteRoadmap = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "Syllabus ID is required." });
    }

    const conditions = [{ slug: id }];
    if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
      conditions.push({ _id: id });
    }

    const roadmap = await Roadmap.findOne({ $or: conditions });

    if (roadmap) {
      const progressConditions = [
        { roadmapId: roadmap._id },
        { roadmapSlug: roadmap.slug },
        { roadmapSlug: id },
      ];
      if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
        progressConditions.push({ roadmapId: id });
      }

      if (req.user) {
        await Progress.deleteMany({
          userId: req.user._id,
          $or: progressConditions,
        });

        // If the user created this roadmap or it has no owner, delete all its progress & remove roadmap
        if (!roadmap.userId || roadmap.userId.toString() === req.user._id.toString()) {
          await Progress.deleteMany({ $or: progressConditions });
          await Roadmap.findByIdAndDelete(roadmap._id);
        }
      } else {
        // Unauthenticated / local fallback
        if (!roadmap.userId) {
          await Progress.deleteMany({ $or: progressConditions });
          await Roadmap.findByIdAndDelete(roadmap._id);
        }
      }
    } else {
      // If roadmap was already removed or only progress remains
      const progressConditions = [{ roadmapSlug: id }];
      if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
        progressConditions.push({ roadmapId: id });
      }

      if (req.user) {
        await Progress.deleteMany({
          userId: req.user._id,
          $or: progressConditions,
        });
      } else {
        await Progress.deleteMany({ $or: progressConditions });
      }
    }

    res.status(200).json({
      success: true,
      message: "Syllabus deleted successfully.",
    });
  } catch (error) {
    console.error("deleteRoadmap error:", error);
    res.status(500).json({ message: error.message || "Failed to delete syllabus." });
  }
};
