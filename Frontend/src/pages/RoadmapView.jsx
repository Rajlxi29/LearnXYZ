import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader,
  ChevronRight,
  BookOpen,
  GitBranch,
  List,
  Sparkles,
  Award,
  Clock,
  Play
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import ProgressRing from '../components/ProgressRing';
import RoadmapFlow from '../components/roadmap/RoadmapFlow';
import API from '../api/axios';
import './RoadmapView.css';


const statusConfig = {
  'completed':   { label: 'Completed',   icon: CheckCircle2, color: 'var(--success)', bg: 'var(--success-dim)', border: 'rgba(52,211,153,0.2)' },
  'in-progress': { label: 'In Progress', icon: Loader,       color: 'var(--primary)', bg: 'var(--primary-dim)', border: 'rgba(91,95,237,0.2)'  },
  'not-started': { label: 'Not Started', icon: Circle,       color: 'var(--text-3)',  bg: 'var(--bg-2)',        border: 'var(--border)'          },
};

function RoadmapListNode({ node, index, onSelect, selected }) {
  const cfg = statusConfig[node.status];
  const Icon = cfg.icon;
  const completedSubs = node.subtopics ? node.subtopics.filter(s => s.status === 'completed').length : 0;
  const totalSubs = node.subtopics ? node.subtopics.length : 0;
  const subPct = totalSubs > 0 ? Math.round((completedSubs / totalSubs) * 100) : 0;

  return (
    <div className={`rm-node-wrap ${selected ? 'selected' : ''}`}>
      {/* Connector line */}
      {index > 0 && <div className="rm-connector" />}

      <div
        className={`rm-node card card-interactive ${node.status}`}
        onClick={() => onSelect(node)}
      >
        <div className="rm-node-left">
          <div className="rm-node-index font-display">{String(index + 1).padStart(2, '0')}</div>
          <div className="rm-node-info">
            <div className="rm-node-title">{node.title}</div>
            <div className="rm-node-meta">
              <span>{totalSubs} subtopics</span>
              &nbsp;·&nbsp;
              <span>{completedSubs} done</span>
            </div>
          </div>
        </div>
        <div className="rm-node-right">
          <div className="rm-node-progress-wrap">
            <div className="progress-track" style={{ width: 80 }}>
              <div className="progress-fill" style={{ width: `${subPct}%`, background: cfg.color }} />
            </div>
            <span className="rm-node-pct">{subPct}%</span>
          </div>
          <div className="rm-node-status" style={{ color: cfg.color }}>
            <Icon size={13} className={node.status === 'in-progress' ? 'spin-slow' : ''} />
            <span>{cfg.label}</span>
          </div>
          <ChevronRight size={15} className="rm-node-arrow" />
        </div>
      </div>
    </div>
  );
}

export default function RoadmapView() {

  const { id } = useParams();
  const navigate = useNavigate();
  const { state, trackTopicProgress } = useApp();

  const [roadmap, setRoadmap] = useState(() => {
    return (
      (state.roadmaps && state.roadmaps.find(r => r.slug === id || r.id === id || r._id === id)) ||
      { id, title: '', nodes: [], category: '', difficulty: '', estimatedHours: 0, description: '' }
    );
  });

  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [viewMode, setViewMode] = useState('flow'); // 'flow' | 'list'

  // Fetch roadmap from backend API
  useEffect(() => {
    let isMounted = true;
    const fetchRoadmap = async () => {
      try {
        setLoading(true);
        const res = await API.get(`/roadmaps/${id}`);
        if (isMounted && res.data) {
          setRoadmap(res.data);
          // Set initial selected node
          const nodes = res.data.nodes || [];
          const active = nodes.find(n => n.status === 'in-progress') || nodes[0] || null;
          setSelectedNode(active);
        }
      } catch (err) {
        console.warn('Could not fetch roadmap from backend, using state/mock:', err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchRoadmap();
    return () => { isMounted = false; };
  }, [id]);

  useEffect(() => {
    if (!selectedNode && roadmap.nodes && roadmap.nodes.length > 0) {
      setSelectedNode(roadmap.nodes.find(n => n.status === 'in-progress') || roadmap.nodes[0]);
    }
  }, [roadmap]);

  // Toggle completion of a subtopic or leaf item
  const handleToggleSubComplete = async (e, subId, currentStatus) => {
    e.stopPropagation();
    const newStatus = currentStatus === 'completed' ? 'not-started' : 'completed';
    const roadmapId = roadmap.slug || roadmap._id || roadmap.id;

    // Optimistically update local roadmap nodes
    setRoadmap(prev => {
      const newNodes = (prev.nodes || []).map(node => {
        const newSubs = (node.subtopics || []).map(sub => {
          if (sub.id === subId) {
            return { ...sub, status: newStatus };
          }
          return sub;
        });
        return { ...node, subtopics: newSubs };
      });
      return { ...prev, nodes: newNodes };
    });

    if (trackTopicProgress) {
      await trackTopicProgress(roadmapId, subId, newStatus);
    }
  };

  const totalSubs = (roadmap.nodes || []).reduce((a, n) => a + (n.subtopics?.length || 0), 0);
  const completedSubs = (roadmap.nodes || []).reduce((a, n) => a + (n.subtopics ? n.subtopics.filter(s => s.status === 'completed').length : 0), 0);
  const overallPct = totalSubs > 0 ? Math.round((completedSubs / totalSubs) * 100) : (roadmap.overallProgress || 0);

  const handleSelect = (node) => {
    setSelectedNode(node);
  };


  return (
    <div className="page-layout">
      <Navbar />
      <main className="roadmap-page animate-in">
        <div className="container">
          {/* Header */}
          <div className="rm-header">
            <button className="rm-back" onClick={() => navigate(-1)}>
              <ArrowLeft size={15} /> Back
            </button>
            <div className="rm-header-main">
              <div className="rm-meta-row">
                <span className="badge badge-primary">{roadmap.category}</span>
                <span className="badge badge-muted">{roadmap.difficulty}</span>
                <span className="badge badge-muted">~{roadmap.estimatedHours}h</span>
              </div>
              <h1 className="rm-title font-display">{roadmap.title}</h1>
              <p className="rm-desc">{roadmap.description}</p>
            </div>
            <div className="rm-progress-card card">
              <ProgressRing progress={overallPct} size={88} strokeWidth={7} />
              <div className="rm-progress-info">
                <div className="rm-progress-label">Overall progress</div>
                <div className="rm-progress-detail">{completedSubs} / {totalSubs} subtopics</div>
                <div className="rm-progress-detail">{roadmap.nodes.filter(n => n.status === 'completed').length} / {roadmap.nodes.length} sections</div>
              </div>
            </div>
          </div>

          {/* View Mode Bar */}
          <div className="rm-toolbar-bar">
            <div className="rm-view-toggle">
              <button
                className={`rm-view-btn ${viewMode === 'flow' ? 'active' : ''}`}
                onClick={() => setViewMode('flow')}
              >
                <GitBranch size={15} />
                <span>React Flow Graph</span>
              </button>
              <button
                className={`rm-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                <List size={15} />
                <span>Timeline List</span>
              </button>
            </div>

            <div className="rm-quick-stats">
              <span className="rm-stat-tag">
                <Sparkles size={13} className="text-primary" /> {roadmap.nodes.length} Key Milestones
              </span>
              <span className="rm-stat-tag">
                <Clock size={13} /> {roadmap.estimatedHours} Hours Total
              </span>
            </div>
          </div>

          {/* Main Content Layout */}
          <div className="rm-content-layout">
            <div className="rm-main-canvas-area">
              {viewMode === 'flow' ? (
                <RoadmapFlow
                  roadmap={roadmap}
                  selectedNode={selectedNode}
                  onSelectNode={handleSelect}
                />
              ) : (
                <div className="rm-nodes card">
                  {roadmap.nodes.map((node, i) => (
                    <RoadmapListNode
                      key={node.id}
                      node={node}
                      index={i}
                      onSelect={handleSelect}
                      selected={selectedNode?.id === node.id}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Side Detail Inspector Panel */}
            {selectedNode && (
              <aside className="rm-detail card animate-scale">
                <div className="rm-detail-header">
                  <div>
                    <span className="rm-detail-tag font-display">
                      STEP {String(roadmap.nodes.findIndex(n => n.id === selectedNode.id) + 1).padStart(2, '0')}
                    </span>
                    <div className="rm-detail-title">{selectedNode.title}</div>
                  </div>
                  <button className="rm-detail-close" onClick={() => setSelectedNode(null)} title="Close Panel">
                    ✕
                  </button>
                </div>

                {/* Subtopic Progress */}
                <div className="rm-detail-meta">
                  <span className={`rm-detail-status ${selectedNode.status}`}>
                    {selectedNode.status === 'completed' && <CheckCircle2 size={13} />}
                    {selectedNode.status === 'in-progress' && <Loader size={13} className="spin-slow" />}
                    {selectedNode.status === 'not-started' && <Circle size={13} />}
                    {selectedNode.status.replace('-', ' ')}
                  </span>
                  <span className="rm-detail-count">
                    {selectedNode.subtopics ? selectedNode.subtopics.filter(s => s.status === 'completed').length : 0} / {selectedNode.subtopics?.length || 0} completed
                  </span>
                </div>

                <div className="rm-subtopics-list">
                  <div className="rm-subtopics-header">Subtopics & Concepts</div>
                  {selectedNode.subtopics && selectedNode.subtopics.map((sub) => {
                    const cfg = statusConfig[sub.status] || statusConfig['not-started'];
                    const Icon = cfg.icon;
                    const items = sub.items || [];
                    return (
                      <div key={sub.id} className="rm-sub-block">
                        <div
                          className="rm-sub"
                          onClick={() => navigate(`/topic/${sub.id}`)}
                          style={{ '--sub-color': cfg.color }}
                        >
                          <div className="rm-sub-left">
                            <div className="rm-sub-dot" style={{ background: cfg.color, opacity: sub.status === 'not-started' ? 0.3 : 1 }} />
                            <span className="rm-sub-title">{sub.title}</span>
                          </div>
                          <div className="rm-sub-right">
                            <button
                              className="rm-sub-status-toggle"
                              title="Toggle completion status"
                              onClick={(e) => handleToggleSubComplete(e, sub.id, sub.status)}
                              style={{
                                color: cfg.color,
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '12px'
                              }}
                            >
                              <Icon size={12} className={sub.status === 'in-progress' ? 'spin-slow' : ''} />
                              <span>{cfg.label}</span>
                            </button>
                            <ChevronRight size={13} className="rm-sub-arrow" />
                          </div>
                        </div>

                        {items.length > 0 && (
                          <div className="rm-sub-items-nest">
                            {items.map((it) => (
                              <div
                                key={it.id}
                                className={`rm-sub-item-leaf ${it.status}`}
                                onClick={(e) => handleToggleSubComplete(e, it.id, it.status)}
                                style={{ cursor: 'pointer' }}
                                title="Click to toggle item completion"
                              >
                                <span className="rm-leaf-dot" />
                                <span>{it.title}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Action Buttons */}
                <div className="rm-detail-actions">
                  <Link
                    to={`/topic/${selectedNode.subtopics?.[0]?.id || selectedNode.id}`}
                    className="btn btn-primary w-full"
                    style={{ justifyContent: 'center' }}
                  >
                    <Play size={14} /> Start / Continue Learning
                  </Link>

                  <Link
                    to={`/quiz/${selectedNode.id}`}
                    className="btn btn-ghost w-full"
                    style={{ justifyContent: 'center' }}
                  >
                    <Award size={14} /> Practice Section Quiz
                  </Link>

                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
