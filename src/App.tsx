import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  loadModel,
  getMetrics,
  isModelReady,
  type ModelStatus,
  type ModelMetrics,
} from './model'
import { analyzeText } from './processor'
import {
  clearCache,
  getCacheStats,
  refreshCacheStats,
  estimateStorage,
  type AnalysisResult,
  type CacheStats,
} from './cache'
import {
  loadSessions,
  saveSessions,
  getActiveSessionId,
  setActiveSessionId,
  createNewSession,
  type ChatMessage,
  type ChatSession,
} from './chatStorage'
import {
  PlusIcon,
  SidebarIcon,
  TrashIcon,
  SendIcon,
  CopyIcon,
  CheckIcon,
  RefreshIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  SparklesIcon,
  ChartIcon,
  SettingsIcon,
  CloseIcon,
  MessageSquareIcon,
  ChevronDownIcon,
} from './icons'

const SAMPLE_PROMPTS = [
  {
    title: 'Customer Review',
    desc: 'Analyze tone & satisfaction',
    prompt:
      'I ordered this product last week and the build quality is extraordinary, but delivery was delayed by three days.',
  },
  {
    title: 'Technical Inquiry',
    desc: 'Detect technical question intent',
    prompt:
      'How do I optimize IndexedDB transactions for heavy offline storage in a multi-threaded web worker?',
  },
  {
    title: 'Commercial Request',
    desc: 'Information & pricing inquiry',
    prompt:
      'Could you please provide the pricing tiers, enterprise licensing terms, and onboarding documentation for our team?',
  },
  {
    title: 'Complexity & Keywords',
    desc: 'Extract heuristics & reading level',
    prompt:
      'Asynchronous event-driven microservices architecture facilitates resilient distributed fault isolation across heterogeneous edge environments.',
  },
]

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const loaded = loadSessions()
    if (loaded.length === 0) {
      const initial = createNewSession('Welcome to MicroPilot')
      saveSessions([initial])
      return [initial]
    }
    return loaded
  })

  const [activeSessionId, setActiveId] = useState<string>(() => {
    const loaded = loadSessions()
    if (loaded.length === 0) return ''
    const lastActive = getActiveSessionId()
    const validActive = loaded.find((s) => s.id === lastActive) ? lastActive! : loaded[0].id
    return validActive
  })

  const [input, setInput] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<ModelMetrics>(getMetrics())
  const [cacheStats, setCacheStats] = useState<CacheStats>({ hits: 0, misses: 0, entries: 0 })
  const [storageEst, setStorageEst] = useState('N/A')
  const [online, setOnline] = useState(navigator.onLine)
  const [modelProgress, setModelProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [statsModalOpen, setStatsModalOpen] = useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({})

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Network status listener
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Storage & cache stats
  useEffect(() => {
    refreshCacheStats().then(setCacheStats)
    estimateStorage().then(setStorageEst)
  }, [])

  // Auto-scroll on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [sessions, activeSessionId, processing])

  // Sync sessions to localStorage
  const updateSessions = useCallback(
    (updater: (prev: ChatSession[]) => ChatSession[]) => {
      setSessions((prev) => {
        const next = updater(prev)
        saveSessions(next)
        return next
      })
    },
    []
  )

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0]

  const refreshMetrics = useCallback(() => {
    setMetrics(getMetrics())
    setCacheStats(getCacheStats())
  }, [])

  // Handle Model Loading
  const handleLoadModel = async () => {
    setError(null)
    try {
      await loadModel((status, progress, message) => {
        setModelProgress(progress)
        setStatusMsg(message || status)
        setMetrics(getMetrics())
      })
      setMetrics(getMetrics())
      estimateStorage().then(setStorageEst)
    } catch (e: any) {
      const msg = e?.message || 'Failed to load model'
      setError(msg)
      setMetrics(getMetrics())
      throw e
    }
  }

  // Handle Send / Analyze
  const handleSend = async (textToSend?: string, forceRefresh = false) => {
    const text = (textToSend ?? input).trim()
    if (!text || processing) return

    setInput('')
    setError(null)

    // Ensure we have an active session
    let currentSessionId = activeSessionId
    if (!currentSessionId || !sessions.some((s) => s.id === currentSessionId)) {
      const newSess = createNewSession()
      currentSessionId = newSess.id
      setActiveId(newSess.id)
      setActiveSessionId(newSess.id)
      updateSessions((prev) => [newSess, ...prev])
    }

    const userMsgId = `user_${Date.now()}`
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    // Add user message immediately
    updateSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentSessionId) return s
        const isFirst = s.messages.length === 0
        const autoTitle = isFirst ? text.slice(0, 28) + (text.length > 28 ? '…' : '') : s.title
        return {
          ...s,
          title: autoTitle,
          updatedAt: Date.now(),
          messages: [...s.messages, userMsg],
        }
      })
    )

    setProcessing(true)

    try {
      // Auto-load model if not ready
      if (!isModelReady()) {
        await handleLoadModel()
        if (!isModelReady()) {
          setProcessing(false)
          return
        }
      }

      const result = await analyzeText(text, {
        doIntent: true,
        doSentiment: true,
        forceRefresh,
      })

      const assistantMsg: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: generateConversationalResponse(text, result),
        result,
        timestamp: Date.now(),
      }

      updateSessions((prev) =>
        prev.map((s) => {
          if (s.id !== currentSessionId) return s
          return {
            ...s,
            updatedAt: Date.now(),
            messages: [...s.messages, assistantMsg],
          }
        })
      )

      refreshMetrics()
      estimateStorage().then(setStorageEst)
    } catch (e: any) {
      setError(e?.message || 'Inference failed')
    } finally {
      setProcessing(false)
      refreshMetrics()
      // Refocus input
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  // Create New Chat
  const handleNewChat = () => {
    const newSess = createNewSession()
    updateSessions((prev) => [newSess, ...prev])
    setActiveId(newSess.id)
    setActiveSessionId(newSess.id)
    setInput('')
    setError(null)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // Delete Chat Session
  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const remaining = sessions.filter((s) => s.id !== id)
    if (remaining.length === 0) {
      const fresh = createNewSession()
      updateSessions(() => [fresh])
      setActiveId(fresh.id)
      setActiveSessionId(fresh.id)
    } else {
      updateSessions(() => remaining)
      if (activeSessionId === id) {
        setActiveId(remaining[0].id)
        setActiveSessionId(remaining[0].id)
      }
    }
  }

  // Clear All Sessions
  const handleClearAllSessions = () => {
    if (confirm('Clear all conversation history?')) {
      const fresh = createNewSession()
      updateSessions(() => [fresh])
      setActiveId(fresh.id)
      setActiveSessionId(fresh.id)
    }
  }

  // Clear Cache
  const handleClearCache = async () => {
    await clearCache()
    setCacheStats({ hits: 0, misses: 0, entries: 0 })
    estimateStorage().then(setStorageEst)
  }

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
    }
  }

  // Keydown handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const modelPillStatusClass = (s: ModelStatus) => {
    if (s === 'ready') return 'ready'
    if (s === 'error') return 'error'
    if (s === 'downloading' || s === 'initializing') return 'downloading'
    return 'idle'
  }

  return (
    <div className="chatgpt-root">
      {/* Mobile sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-top">
          <button className="new-chat-btn" onClick={handleNewChat}>
            <div className="new-chat-content">
              <span className="logo-sparkle">
                <SparklesIcon size={16} />
              </span>
              <span>New chat</span>
            </div>
            <PlusIcon size={16} />
          </button>
        </div>

        <div className="sidebar-history-label">Recent Chats</div>

        <div className="sidebar-history-list">
          {sessions.map((sess) => {
            const isActive = sess.id === activeSessionId
            return (
              <div
                key={sess.id}
                className={`history-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(sess.id)
                  setActiveSessionId(sess.id)
                }}
              >
                <div className="history-icon">
                  <MessageSquareIcon size={15} />
                </div>
                <div className="history-title">{sess.title}</div>
                <button
                  className="history-delete-btn"
                  title="Delete chat"
                  onClick={(e) => handleDeleteSession(sess.id, e)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="sidebar-footer">
          <div className="edge-info-card">
            <div className="edge-info-header">
              <span className="badge-edge">100% On-Device</span>
              <span className="edge-model-name">MobileBERT-MNLI</span>
            </div>
            <p className="edge-info-sub">Quantized ONNX · Transformers.js Web</p>
          </div>

          <div className="sidebar-footer-actions">
            <button
              className="sidebar-footer-btn"
              onClick={() => setStatsModalOpen(true)}
              title="Edge Telemetry & Settings"
            >
              <SettingsIcon size={16} />
              <span>Settings & Telemetry</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="main-content">
        {/* Top Header */}
        <header className="chat-header">
          <div className="chat-header-left">
            <button
              className="icon-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              title="Toggle sidebar"
            >
              <SidebarIcon size={19} />
            </button>

            <button
              className="model-selector-btn"
              onClick={() => setModelDropdownOpen((prev) => !prev)}
            >
              <div className="model-selector-inner">
                <span className="model-title">MicroPilot</span>
                <span className="model-badge">MobileBERT Edge</span>
              </div>
              <ChevronDownIcon size={14} />
            </button>

            {modelDropdownOpen && (
              <div className="model-dropdown">
                <div className="dropdown-title">Active Edge Model</div>
                <div className="dropdown-desc">
                  Runs zero-shot text classification and local heuristics entirely on your device.
                  No cloud API calls or prompt transmission.
                </div>
                <div className="dropdown-meta">
                  <div><strong>ID:</strong> Xenova/mobilebert-uncased-mnli</div>
                  <div><strong>Size:</strong> ~27 MB (quantized ONNX)</div>
                  <div><strong>Engine:</strong> ONNX Runtime WASM</div>
                </div>
                <button
                  className="dropdown-action-btn"
                  onClick={() => {
                    handleLoadModel()
                    setModelDropdownOpen(false)
                  }}
                >
                  {isModelReady() ? 'Reload Model Weights' : 'Preload Model Now'}
                </button>
              </div>
            )}
          </div>

          <div className="chat-header-right">
            <span className={`status-pill ${modelPillStatusClass(metrics.status)}`}>
              <span className="status-dot" />
              {metrics.status === 'ready'
                ? 'AI Ready'
                : metrics.status === 'downloading'
                ? `DL ${modelProgress}%`
                : metrics.status === 'initializing'
                ? 'Init…'
                : metrics.status === 'error'
                ? 'Error'
                : 'AI Idle'}
            </span>

            <span className={`status-pill ${online ? 'online' : 'offline'}`}>
              <span className="status-dot" />
              {online ? 'Online' : 'Offline'}
            </span>

            <button
              className="icon-btn header-stats-btn"
              onClick={() => setStatsModalOpen(true)}
              title="View edge performance telemetry"
            >
              <ChartIcon size={17} />
            </button>

            <button
              className="icon-btn mobile-new-btn"
              onClick={handleNewChat}
              title="New Chat"
            >
              <PlusIcon size={18} />
            </button>
          </div>
        </header>

        {/* Message Stream */}
        <div className="message-scroll-area">
          {(!activeSession || activeSession.messages.length === 0) && (
            <div className="hero-container">
              <div className="hero-mark">
                <SparklesIcon size={32} />
              </div>
              <h1 className="hero-title">What text would you like to analyze?</h1>
              <p className="hero-subtitle">
                On-device zero-shot classification, sentiment analysis, and text intelligence powered by MobileBERT.
              </p>

              <div className="prompt-grid">
                {SAMPLE_PROMPTS.map((sample, idx) => (
                  <div
                    key={idx}
                    className="prompt-card"
                    onClick={() => handleSend(sample.prompt)}
                  >
                    <div className="prompt-card-title">{sample.title}</div>
                    <div className="prompt-card-desc">{sample.desc}</div>
                    <div className="prompt-card-snippet">“{sample.prompt}”</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSession && activeSession.messages.length > 0 && (
            <div className="messages-list">
              {activeSession.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onReAnalyze={() => handleSend(msg.content, true)}
                  feedback={feedbackMap[msg.id]}
                  onFeedback={(type) =>
                    setFeedbackMap((prev) => ({
                      ...prev,
                      [msg.id]: prev[msg.id] === type ? (undefined as any) : type,
                    }))
                  }
                />
              ))}

              {processing && (
                <div className="message-row assistant">
                  <div className="avatar assistant-avatar">
                    <SparklesIcon size={16} />
                  </div>
                  <div className="message-bubble assistant-bubble">
                    <div className="thinking-row">
                      <span className="pulsing-dot" />
                      <span className="thinking-text">
                        {statusMsg ||
                          (metrics.status === 'downloading'
                            ? `Downloading MobileBERT model (${modelProgress}%)…`
                            : metrics.status === 'initializing'
                            ? 'Warming up WASM runtime…'
                            : 'Analyzing on-device…')}
                      </span>
                    </div>
                    {metrics.status === 'downloading' && (
                      <div className="dl-progress-bar-wrap">
                        <div
                          className="dl-progress-bar-fill"
                          style={{ width: `${modelProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Floating Input Dock */}
        <div className="input-dock-container">
          {error && <div className="input-error-toast">{error}</div>}

          <div className="input-dock">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message MicroPilot or paste text to analyze locally…"
              disabled={processing}
            />

            <button
              className={`send-button ${input.trim() ? 'active' : ''}`}
              onClick={() => handleSend()}
              disabled={!input.trim() || processing}
              title="Analyze text"
            >
              <SendIcon size={15} />
            </button>
          </div>

          <div className="dock-disclaimer">
            MicroPilot performs edge-only inference with MobileBERT-MNLI. Text never leaves your device.
          </div>
        </div>
      </div>

      {/* Telemetry & Settings Modal */}
      {statsModalOpen && (
        <div className="modal-backdrop" onClick={() => setStatsModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <ChartIcon size={20} />
                <h2>Edge Telemetry & Settings</h2>
              </div>
              <button
                className="icon-btn"
                onClick={() => setStatsModalOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="stats-section-title">Engine Metrics</div>
              <div className="modal-grid">
                <div className="stat-box">
                  <div className="stat-label">Model</div>
                  <div className="stat-val">{metrics.modelName}</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Model Artifact</div>
                  <div className="stat-val small-mono">{metrics.artifact}</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Download Time</div>
                  <div className="stat-val">
                    {metrics.downloadDurationMs != null
                      ? `${(metrics.downloadDurationMs / 1000).toFixed(2)}s`
                      : '—'}
                  </div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Warm-Up Init</div>
                  <div className="stat-val">
                    {metrics.initDurationMs != null ? `${metrics.initDurationMs} ms` : '—'}
                  </div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Last Latency</div>
                  <div className="stat-val highlight">
                    {metrics.lastInferenceMs != null ? `${metrics.lastInferenceMs} ms` : '—'}
                  </div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Avg AI Latency</div>
                  <div className="stat-val">
                    {metrics.avgInferenceMs != null ? `${metrics.avgInferenceMs} ms` : '—'}
                  </div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Total Inferences</div>
                  <div className="stat-val">{metrics.inferenceCount}</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Local Heuristic Ops</div>
                  <div className="stat-val">{metrics.localOpCount}</div>
                </div>
              </div>

              <div className="stats-section-title" style={{ marginTop: 18 }}>
                IndexedDB Cache & Storage
              </div>
              <div className="modal-grid">
                <div className="stat-box">
                  <div className="stat-label">Cache Hits / Misses</div>
                  <div className="stat-val">
                    <span className="green-text">{cacheStats.hits}</span> /{' '}
                    <span className="muted-text">{cacheStats.misses}</span>
                  </div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Cached Entries</div>
                  <div className="stat-val">{cacheStats.entries}</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Storage Usage</div>
                  <div className="stat-val">{storageEst}</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Cache Speedup</div>
                  <div className="stat-val green-text">
                    {cacheStats.hits > 0 ? '~1 ms (instant)' : 'Ready'}
                  </div>
                </div>
              </div>

              <div className="modal-actions-list">
                <button className="modal-action-btn" onClick={handleLoadModel}>
                  Reload Model Weights
                </button>
                <button className="modal-action-btn danger" onClick={handleClearCache}>
                  Clear Model & Inference Cache
                </button>
                <button className="modal-action-btn danger" onClick={handleClearAllSessions}>
                  Clear All Conversation History
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function generateConversationalResponse(
  _text: string,
  result: AnalysisResult
): string {
  const intentLabel = result.intent ? result.intent.label : 'General'
  const intentConfidence = result.intent ? (result.intent.score * 100).toFixed(1) : '100'
  const sentimentLabel = result.sentiment ? result.sentiment.label : 'neutral'
  const sentimentConfidence = result.sentiment ? (result.sentiment.score * 100).toFixed(1) : '100'

  return `I analyzed your text on-device. Here are the core insights:

• **Primary Intent:** **${intentLabel}** (${intentConfidence}% confidence)
• **Sentiment Tone:** **${sentimentLabel.toUpperCase()}** (${sentimentConfidence}% confidence)
• **Text Complexity:** **${result.stats.complexity}** (${result.stats.wordCount} words, ${result.stats.sentenceCount} sentences)
${result.stats.keywords.length > 0 ? `• **Key Keywords:** ${result.stats.keywords.join(', ')}` : ''}`
}

function MessageBubble({
  message,
  onReAnalyze,
  feedback,
  onFeedback,
}: {
  message: ChatMessage
  onReAnalyze: () => void
  feedback?: 'up' | 'down'
  onFeedback: (type: 'up' | 'down') => void
}) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const { result } = message

  const handleCopy = () => {
    let textToCopy = message.content
    if (result) {
      textToCopy += `\n\n--- Detailed Metrics ---\nIntent: ${result.intent?.label} (${(
        (result.intent?.score || 0) * 100
      ).toFixed(1)}%)\nSentiment: ${result.sentiment?.label}\nLatency: ${result.inferenceMs} ms\nSource: ${
        result.fromCache ? 'Cache' : 'On-device AI'
      }`
    }
    navigator.clipboard.writeText(textToCopy).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  if (isUser) {
    return (
      <div className="message-row user">
        <div className="message-bubble user-bubble">
          <div className="user-message-text">{message.content}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="message-row assistant">
      <div className="avatar assistant-avatar">
        <SparklesIcon size={16} />
      </div>

      <div className="message-bubble assistant-bubble">
        {/* Conversational Text */}
        <div className="assistant-text-content">
          {message.content.split('\n\n').map((paragraph, i) => (
            <p key={i} style={{ marginBottom: i < 1 ? 12 : 0 }}>
              {paragraph.split('\n').map((line, j) => {
                // Formatting bullet points cleanly
                if (line.startsWith('• ')) {
                  const parts = line.slice(2).split('**')
                  return (
                    <span key={j} className="bullet-line">
                      <span className="bullet-dot">•</span>
                      <span>
                        {parts.map((p, k) =>
                          k % 2 === 1 ? <strong key={k}>{p}</strong> : p
                        )}
                      </span>
                    </span>
                  )
                }
                return (
                  <span key={j}>
                    {line}
                    <br />
                  </span>
                )
              })}
            </p>
          ))}
        </div>

        {/* Detailed Interactive AI Cards */}
        {result && (
          <div className="assistant-rich-panel">
            {/* Intent Breakdown */}
            {result.intent && (
              <div className="rich-section">
                <div className="rich-section-header">
                  <span className="rich-section-title">Zero-Shot Intent Confidence</span>
                  <span className="rich-pill primary">
                    {result.intent.label} · {(result.intent.score * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="intent-bars-list">
                  {result.intent.allScores.slice(0, 4).map((s) => (
                    <div className="intent-bar-row" key={s.label}>
                      <span className="intent-bar-label">{s.label}</span>
                      <div className="intent-bar-track">
                        <div
                          className="intent-bar-fill"
                          style={{ width: `${Math.round(s.score * 100)}%` }}
                        />
                      </div>
                      <span className="intent-bar-percent">
                        {(s.score * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sentiment & Text Stats Grid */}
            <div className="rich-columns-grid">
              {result.sentiment && (
                <div className="rich-sub-card">
                  <div className="sub-card-label">Sentiment Detection</div>
                  <div className="sentiment-display">
                    <span className={`sentiment-tag ${result.sentiment.label}`}>
                      {result.sentiment.label}
                    </span>
                    <span className="sentiment-score">
                      {(result.sentiment.score * 100).toFixed(1)}% confidence
                    </span>
                  </div>
                </div>
              )}

              <div className="rich-sub-card">
                <div className="sub-card-label">Text Heuristics</div>
                <div className="stats-inline-row">
                  <div><strong>{result.stats.wordCount}</strong> words</div>
                  <div><strong>{result.stats.charCount}</strong> chars</div>
                  <div><strong>{result.stats.sentenceCount}</strong> sents</div>
                  <div className="complexity-badge">{result.stats.complexity}</div>
                </div>
              </div>
            </div>

            {/* Keywords */}
            {result.stats.keywords.length > 0 && (
              <div className="keywords-chip-row">
                <span className="keywords-label">Keywords:</span>
                {result.stats.keywords.map((kw) => (
                  <span key={kw} className="keyword-chip">
                    {kw}
                  </span>
                ))}
              </div>
            )}

            {/* Execution / Cache Latency Banner */}
            <div className="execution-banner">
              <div className="execution-source">
                {result.fromCache ? (
                  <span className="source-badge cache">
                    ⚡ Exact-Match Cache
                  </span>
                ) : (
                  <span className="source-badge ai">
                    🧠 On-Device MobileBERT
                  </span>
                )}
                <span className="latency-label">
                  Response time: <strong>{result.inferenceMs} ms</strong>
                  {result.fromCache && result.originalInferenceMs && (
                    <span className="saved-latency-pill">
                      Saved ~{result.originalInferenceMs} ms
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Action Toolbar */}
        <div className="assistant-action-bar">
          <button
            className="action-btn"
            onClick={handleCopy}
            title="Copy message and analysis"
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            className="action-btn"
            onClick={onReAnalyze}
            title="Re-run live on-device inference (bypasses cache)"
          >
            <RefreshIcon size={14} />
            <span>Re-run live</span>
          </button>

          <button
            className={`action-btn icon-only ${feedback === 'up' ? 'active' : ''}`}
            onClick={() => onFeedback('up')}
            title="Good response"
          >
            <ThumbsUpIcon size={14} />
          </button>

          <button
            className={`action-btn icon-only ${feedback === 'down' ? 'active' : ''}`}
            onClick={() => onFeedback('down')}
            title="Bad response"
          >
            <ThumbsDownIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
