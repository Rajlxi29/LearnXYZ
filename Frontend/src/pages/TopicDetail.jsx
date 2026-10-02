import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Loader, Play, ExternalLink, BookOpen, Code, FileText, ChevronDown, ChevronUp, Brain } from 'lucide-react';
import { useApp } from '../context/AppContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import './TopicDetail.css';

const resourceTypeConfig = {
  docs:    { icon: FileText, label: 'Docs',    color: 'var(--primary)' },
  article: { icon: BookOpen, label: 'Article', color: 'var(--gold)' },
  tool:    { icon: Code,     label: 'Tool',    color: 'var(--success)' },
};

const statusConfig = {
  'completed':   { label: 'Completed',   icon: CheckCircle2, color: 'var(--success)', bg: 'var(--success-dim)' },
  'in-progress': { label: 'In Progress', icon: Loader,       color: 'var(--primary)', bg: 'var(--primary-dim)' },
  'not-started': { label: 'Not Started', icon: Circle,       color: 'var(--text-3)',  bg: 'var(--bg-2)'        },
};

function VideoCard({ video, isActive, onClick }) {
  return (
    <div className={`video-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="video-thumbnail">
        <img src={video.thumbnail} alt={video.title} loading="lazy"
          onError={e => { e.target.style.display='none'; }} />
        <div className="video-play-btn"><Play size={14} fill="currentColor" /></div>
        <div className="video-duration">{video.duration}</div>
      </div>
      <div className="video-info">
        <div className="video-title">{video.title}</div>
        <div className="video-channel">{video.channel}</div>
      </div>
    </div>
  );
}

export default function TopicDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, trackTopicProgress } = useApp();

  // Dynamically resolve topic from generated roadmaps
  const topic = React.useMemo(() => {
    // Search in all loaded roadmaps
    for (const rm of state.roadmaps || []) {
      for (const node of rm.nodes || []) {
        if (node.id === id) {
          const rawArticles = (node.subtopics || []).flatMap(s => s.articles || []);
          const resList = rawArticles.map((a, idx) => ({
            id: `res-${idx + 1}`,
            title: typeof a === 'string' ? `${node.title} Reference ${idx + 1}` : a.title,
            url: typeof a === 'string' ? a : a.url,
            type: 'article',
            description: typeof a === 'string' ? 'Curated Learning Resource' : (a.source || 'Reference Guide'),
          }));

          return {
            id: node.id,
            title: node.title,
            description: node.definition || `Mastery section for ${node.title}`,
            roadmapSlug: rm.slug || rm._id,
            videos: (node.subtopics || [])
              .filter(s => s.video && s.video.youtubeId)
              .map(s => ({
                id: s.id,
                title: s.video.title || s.title,
                channel: s.video.channel || 'Curated Tutorial',
                duration: s.video.duration || '15:00',
                youtubeId: s.video.youtubeId,
                thumbnail: s.video.thumbnail,
              })),
            resources: resList,
            articles: resList,
            subtopics: (node.subtopics || []).map(s => ({
              id: s.id,
              title: s.title,
              duration: '30m',
              status: state.topicProgress[s.id] || s.status || 'not-started',
              keyTakeaway: s.definition || `Key concepts of ${s.title}`,
            })),
          };
        }

        // Check subtopics
        for (const sub of node.subtopics || []) {
          if (sub.id === id) {
            const resList = (sub.articles || []).map((a, idx) => ({
              id: `res-${idx + 1}`,
              title: typeof a === 'string' ? `${sub.title} Guide ${idx + 1}` : a.title,
              url: typeof a === 'string' ? a : a.url,
              type: 'article',
              description: typeof a === 'string' ? 'Curated Reference Resource' : (a.source || 'Reference Guide'),
            }));

            return {
              id: sub.id,
              title: sub.title,
              description: sub.definition || `In-depth tutorial for ${sub.title}`,
              roadmapSlug: rm.slug || rm._id,
              videos: sub.video ? [{
                id: sub.id,
                title: sub.video.title || `${sub.title} Video`,
                channel: sub.video.channel || 'Curated Lecture',
                duration: sub.video.duration || '15:00',
                youtubeId: sub.video.youtubeId || '0_J3G1uBvhA',
                thumbnail: sub.video.thumbnail,
              }] : [],
              resources: resList,
              articles: resList,
              subtopics: (sub.items || []).map(it => ({
                id: it.id,
                title: it.title,
                duration: '20m',
                status: state.topicProgress[it.id] || it.status || 'not-started',
                keyTakeaway: `Mastery point for ${it.title}`,
              })),
            };
          }
        }
      }
    }

    return topicDetails['javascript'];
  }, [id, state.roadmaps, state.topicProgress]);


  const [activeVideo, setActiveVideo] = useState(() => (topic.videos && topic.videos[0]) || null);
  const [expandedSub, setExpandedSub] = useState(null);
  const [completedSubs, setCompletedSubs] = useState(() => {
    return new Set(
      (topic.subtopics || [])
        .filter(s => state.topicProgress[s.id] === 'completed' || s.status === 'completed')
        .map(s => s.id)
    );
  });

  React.useEffect(() => {
    if (topic.videos && topic.videos.length > 0 && !activeVideo) {
      setActiveVideo(topic.videos[0]);
    }
  }, [topic]);

  const progressPct = topic.subtopics && topic.subtopics.length > 0
    ? Math.round((completedSubs.size / topic.subtopics.length) * 100)
    : 0;

  const toggleSubComplete = async (subId) => {
    const isDone = completedSubs.has(subId);
    const newStatus = isDone ? 'not-started' : 'completed';

    setCompletedSubs(prev => {
      const next = new Set(prev);
      if (isDone) next.delete(subId); else next.add(subId);
      return next;
    });

    dispatch({ type: 'MARK_TOPIC', payload: { id: subId, status: newStatus } });

    if (trackTopicProgress) {
      const rmId = topic.roadmapSlug || id;
      await trackTopicProgress(rmId, subId, newStatus);
    }
  };


  const quizTargetId = topic.id || id;

  return (
    <div className="page-layout">
      <Navbar />
      <main className="topic-page animate-in">
        <div className="container">
          {/* Back */}
          <button className="rm-back" onClick={() => navigate(-1)}>
            <ArrowLeft size={15} /> Back to roadmap
          </button>

          {/* Header */}
          <div className="tp-header">
            <div className="tp-header-main">
              <h1 className="tp-title font-display">{topic.title}</h1>
              <p className="tp-desc">{topic.description}</p>
              <div className="tp-progress-row">
                <div className="progress-track" style={{ flex: 1, maxWidth: 280 }}>
                  <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="tp-pct">{progressPct}% complete</span>
              </div>
            </div>
            <Link to={`/quiz/${quizTargetId}`} className="btn btn-primary tp-quiz-btn">
              <Brain size={15} /> Take quiz
            </Link>
          </div>

          {/* Body */}
          <div className="tp-body">
            {/* Left: Videos + Resources */}
            <div className="tp-col-main">
              {/* Video player */}
              {activeVideo ? (
                <div className="tp-video-player card">
                  <iframe
                    src={`https://www.youtube.com/embed/${activeVideo.youtubeId}?autoplay=1`}
                    title={activeVideo.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="tp-iframe"
                  />
                  <div className="tp-video-meta">
                    <div className="tp-video-title">{activeVideo.title}</div>
                    <div className="tp-video-channel">{activeVideo.channel}</div>
                  </div>
                </div>
              ) : (
                <div className="tp-video-placeholder card" onClick={() => setActiveVideo(topic.videos[0])}>
                  <div className="tp-ph-icon"><Play size={32} fill="currentColor" /></div>
                  <div className="tp-ph-text">Click a video below to start watching</div>
                </div>
              )}

              {/* Video list */}
              {topic.videos && topic.videos.length > 0 && (
                <>
                  <div className="tp-section-header">
                    <h2 className="tp-section-title">Videos</h2>
                    <span className="tp-section-count">{topic.videos.length} curated</span>
                  </div>
                  <div className="tp-video-list">
                    {topic.videos.map(v => (
                      <VideoCard
                        key={v.id}
                        video={v}
                        isActive={activeVideo?.id === v.id}
                        onClick={() => setActiveVideo(v)}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Resources */}
              <div className="tp-section-header" style={{ marginTop: 'var(--space-8)' }}>
                <h2 className="tp-section-title">Resources</h2>
                <span className="tp-section-count">{(topic.resources || topic.articles || []).length} links</span>
              </div>
              <div className="tp-resources">
                {(topic.resources || topic.articles || []).map(r => {
                  const cfg = resourceTypeConfig[r.type] || resourceTypeConfig.article;
                  const Icon = cfg.icon;
                  return (
                    <a key={r.id || r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="tp-resource card card-interactive">
                      <div className="tp-resource-icon" style={{ background: `${cfg.color}15`, color: cfg.color }}>
                        <Icon size={16} strokeWidth={1.5} />
                      </div>
                      <div className="tp-resource-info">
                        <div className="tp-resource-title">{r.title}</div>
                        <div className="tp-resource-desc">{r.description || 'Curated reference guide'}</div>
                      </div>
                      <ExternalLink size={13} className="tp-resource-ext" />
                    </a>
                  );
                })}
              </div>

            </div>

            {/* Right: Subtopics */}
            <div className="tp-col-side">
              <div className="tp-subtopics-header">
                <h2 className="tp-section-title">Subtopics</h2>
                <span className="tp-pct-small">{completedSubs.size}/{topic.subtopics.length}</span>
              </div>
              <div className="tp-subtopics card">
                {topic.subtopics.map((sub, i) => {
                  const isDone = completedSubs.has(sub.id);
                  const isExpanded = expandedSub === sub.id;
                  return (
                    <div key={sub.id} className={`tp-sub ${isDone ? 'done' : ''}`}>
                      <div className="tp-sub-header" onClick={() => setExpandedSub(isExpanded ? null : sub.id)}>
                        <div className="tp-sub-left">
                          <div className={`tp-sub-dot ${isDone ? 'done' : sub.status === 'in-progress' ? 'active' : ''}`} />
                          <span className="tp-sub-title">{sub.title}</span>
                        </div>
                        <div className="tp-sub-right">
                          {isExpanded ? <ChevronUp size={13} className="tp-chevron" /> : <ChevronDown size={13} className="tp-chevron" />}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="tp-sub-body animate-in">
                          <p className="tp-sub-desc">{sub.description}</p>
                          <button
                            className={`btn btn-sm ${isDone ? 'btn-secondary' : 'btn-primary'} tp-mark-btn`}
                            onClick={() => toggleSubComplete(sub.id)}
                          >
                            {isDone ? <><Circle size={12} /> Mark incomplete</> : <><CheckCircle2 size={12} /> Mark complete</>}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Progress card */}
              <div className="tp-progress-widget card">
                <div className="tp-pw-label">Topic progress</div>
                <div className="tp-pw-ring">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="tp-pw-pct">{progressPct}%</span>
                </div>
                <Link to={`/quiz/${quizTargetId}`} className="btn btn-primary btn-sm tp-quiz-side">
                  <Brain size={13} /> Take the quiz
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
