import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  ArrowUp,
  Copy,
  Check,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  BarChart3,
  Settings,
  X,
  MessageSquare,
  ChevronDown,
  Activity,
  Cpu,
  Database,
  Wifi,
  WifiOff,
  Bell,
  BellRing,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import {
  loadModel,
  getMetrics,
  isModelReady,
  type ModelStatus,
  type ModelMetrics,
} from './model'
import {
  analyzeText,
  analyzeNotification,
  type IncomingNotification,
  type NotificationReport,
} from './processor'
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
  isNativeAndroid,
  isNotificationListenerEnabled,
  openAndroidNotificationSettings,
  requestPushPermission,
  getWebPushPermission,
  dispatchReportPushNotification,
  subscribeToIncomingNotifications,
  consumeSharedTargetPayload,
} from './notificationBridge'

const REPORTS_STORAGE_KEY = 'micropilot_notification_reports_v1'

function loadStoredReports(): NotificationReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveStoredReports(reports: NotificationReport[]) {
  try {
    localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports.slice(0, 50)))
  } catch {
    // Ignore storage quota errors
  }
}

const SAMPLE_PROMPTS = [
  {
    title: 'Customer Review',
    prompt:
      'I ordered this product last week and the build quality is extraordinary, but delivery was delayed by three days.',
  },
  {
    title: 'Technical Inquiry',
    prompt:
      'How do I optimize IndexedDB transactions for heavy offline storage in a multi-threaded web worker?',
  },
  {
    title: 'Commercial Request',
    prompt:
      'Could you please provide the pricing tiers, enterprise licensing terms, and onboarding documentation for our team?',
  },
  {
    title: 'Complexity Check',
    prompt:
      'Asynchronous event-driven microservices architecture facilitates resilient distributed fault isolation across heterogeneous edge environments.',
  },
]

const SIMULATED_NOTIFICATIONS: Omit<IncomingNotification, 'id' | 'timestamp'>[] = [
  {
    packageName: 'com.whatsapp',
    appName: 'WhatsApp',
    title: 'Alex (Lead)',
    text: 'Production API is returning 502 errors right now, please check immediately!',
  },
  {
    packageName: 'com.bank.alerts',
    appName: 'HDFC Bank',
    title: 'Transaction OTP',
    text: 'Your OTP for online payment of Rs. 45,000 is 894210. Do not share this code with anyone.',
  },
  {
    packageName: 'com.android.mms',
    appName: 'Messages',
    title: '+1-800-555-0199',
    text: 'URGENT: Your bank account has been suspended. Click http://bit.ly/verify-kyc-now to avoid penalty.',
  },
  {
    packageName: 'com.shopping.deals',
    appName: 'ShopNow',
    title: 'Flash Sale Live',
    text: 'Get up to 70% off on sneakers and electronics today only. Tap to shop.',
  },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<'radar' | 'chat'>('radar')

  // Chat state
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

  // Notification Radar state
  const [reports, setReports] = useState<NotificationReport[]>(() => loadStoredReports())
  const [nativeListenerEnabled, setNativeListenerEnabled] = useState(false)
  const [pushGranted, setPushGranted] = useState(() => getWebPushPermission() === 'granted')
  const [simApp, setSimApp] = useState('WhatsApp')
  const [simText, setSimText] = useState('')
  const [analyzingNotif, setAnalyzingNotif] = useState(false)

  // Shared UI & Engine state
  const [input, setInput] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<ModelMetrics>(getMetrics())
  const [cacheStats, setCacheStats] = useState<CacheStats>({ hits: 0, misses: 0, entries: 0 })
  const [storageEst, setStorageEst] = useState('N/A')
  const [online, setOnline] = useState(navigator.onLine)
  const [modelProgress, setModelProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [statsModalOpen, setStatsModalOpen] = useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({})

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const refreshMetrics = useCallback(() => {
    setMetrics(getMetrics())
    setCacheStats(getCacheStats())
  }, [])

  const handleLoadModel = useCallback(async () => {
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
  }, [])

  // Process any incoming notification (from Android OS, Share Target, or Simulator)
  const processIncomingNotification = useCallback(
    async (notif: IncomingNotification) => {
      setAnalyzingNotif(true)
      setError(null)
      try {
        if (!isModelReady()) {
          await handleLoadModel()
          if (!isModelReady()) return
        }
        const report = await analyzeNotification(notif)
        setReports((prev) => {
          const next = [report, ...prev].slice(0, 50)
          saveStoredReports(next)
          return next
        })
        await dispatchReportPushNotification(report)
        refreshMetrics()
        estimateStorage().then(setStorageEst)
      } catch (e: any) {
        setError(e?.message || 'Failed to analyze notification')
      } finally {
        setAnalyzingNotif(false)
        refreshMetrics()
      }
    },
    [handleLoadModel, refreshMetrics]
  )

  // Check permissions, subscribe to Android NotificationListener, and handle Web Share Target
  useEffect(() => {
    let cleanupFn: (() => void) | null = null

    const initBridge = async () => {
      if (isNativeAndroid()) {
        const enabled = await isNotificationListenerEnabled()
        setNativeListenerEnabled(enabled)
      }
      const shared = consumeSharedTargetPayload()
      if (shared) {
        setActiveTab('radar')
        await processIncomingNotification(shared)
      }
      cleanupFn = await subscribeToIncomingNotifications((incoming) => {
        processIncomingNotification(incoming)
      })
    }

    initBridge()

    const onVisibility = async () => {
      if (document.visibilityState === 'visible' && isNativeAndroid()) {
        const enabled = await isNotificationListenerEnabled()
        setNativeListenerEnabled(enabled)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (cleanupFn) cleanupFn()
    }
  }, [processIncomingNotification])

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

  useEffect(() => {
    refreshCacheStats().then(setCacheStats)
    estimateStorage().then(setStorageEst)
  }, [])

  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [sessions, activeSessionId, processing, activeTab])

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

  const handleSend = async (textToSend?: string, forceRefresh = false) => {
    const text = (textToSend ?? input).trim()
    if (!text || processing) return

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setError(null)

    let currentSessionId = activeSessionId
    if (!currentSessionId || !sessions.some((s) => s.id === currentSessionId)) {
      const newSess = createNewSession()
      currentSessionId = newSess.id
      setActiveId(newSess.id)
      setActiveSessionId(newSess.id)
      updateSessions((prev) => [newSess, ...prev])
    }

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    updateSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentSessionId) return s
        const isFirst = s.messages.length === 0
        const autoTitle = isFirst ? text.slice(0, 26) + (text.length > 26 ? '…' : '') : s.title
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
        content: generateConversationalResponse(result),
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
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  const handleNewChat = () => {
    const newSess = createNewSession()
    updateSessions((prev) => [newSess, ...prev])
    setActiveId(newSess.id)
    setActiveSessionId(newSess.id)
    setActiveTab('chat')
    setInput('')
    setError(null)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

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

  const handleClearAllSessions = () => {
    if (confirm('Clear all conversation history?')) {
      const fresh = createNewSession()
      updateSessions(() => [fresh])
      setActiveId(fresh.id)
      setActiveSessionId(fresh.id)
    }
  }

  const handleClearReports = () => {
    setReports([])
    saveStoredReports([])
  }

  const handleClearCache = async () => {
    await clearCache()
    setCacheStats({ hits: 0, misses: 0, entries: 0 })
    estimateStorage().then(setStorageEst)
  }

  const handleEnablePush = async () => {
    const granted = await requestPushPermission()
    setPushGranted(granted)
  }

  const handleSimulateCustom = (e: React.FormEvent) => {
    e.preventDefault()
    const text = simText.trim()
    if (!text || analyzingNotif) return
    setSimText('')
    processIncomingNotification({
      id: `sim_${Date.now()}`,
      packageName: `com.sim.${simApp.toLowerCase().replace(/\s+/g, '')}`,
      appName: simApp || 'Messages',
      title: 'Incoming Notification',
      text,
      timestamp: Date.now(),
    })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
    }
  }

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

  const nativeAndroid = isNativeAndroid()

  return (
    <div className="nb-root">
      {sidebarOpen && (
        <div
          className="nb-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Neo-Brutalist Sidebar */}
      <aside className={`nb-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-top-bar">
          <div className="brand-inline">
            <img src="/logo.png" alt="MicroPilot" className="logo-sidebar" />
            <span className="brand-name">MicroPilot</span>
          </div>
          <button
            className="nb-icon-btn flat"
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <div className="sidebar-nav-modes">
          <button
            className={`nb-mode-btn ${activeTab === 'radar' ? 'active' : ''}`}
            onClick={() => setActiveTab('radar')}
          >
            <BellRing size={15} />
            <span>Notification Radar</span>
            {reports.length > 0 && <span className="mode-count">{reports.length}</span>}
          </button>

          <button
            className={`nb-mode-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={15} />
            <span>AI Analyzer Chat</span>
          </button>
        </div>

        <div className="sidebar-new-wrap">
          <button className="nb-btn-primary full" onClick={handleNewChat}>
            <span>New chat</span>
            <Plus size={16} />
          </button>
        </div>

        <div className="sidebar-label">Recent Chats</div>

        <div className="sidebar-list">
          {sessions.map((sess) => {
            const isActive = activeTab === 'chat' && sess.id === activeSessionId
            return (
              <div
                key={sess.id}
                className={`nb-chat-row ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(sess.id)
                  setActiveSessionId(sess.id)
                  setActiveTab('chat')
                }}
              >
                <MessageSquare size={14} className="chat-row-icon" />
                <span className="chat-row-title">{sess.title}</span>
                <button
                  className="chat-row-del"
                  title="Delete chat"
                  onClick={(e) => handleDeleteSession(sess.id, e)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="sidebar-bottom">
          <button
            className="nb-sidebar-footer-btn"
            onClick={() => setStatsModalOpen(true)}
          >
            <Settings size={15} />
            <span>Settings & Telemetry</span>
          </button>
        </div>
      </aside>

      {/* Main Content Container */}
      <div className="nb-main">
        {/* Top Header */}
        <header className="nb-header">
          <div className="header-left">
            {!sidebarOpen && (
              <button
                className="nb-icon-btn"
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
              >
                <PanelLeft size={18} />
              </button>
            )}

            <button
              className="nb-model-selector"
              onClick={() => setModelDropdownOpen((prev) => !prev)}
            >
              <img src="/logo.png" alt="MicroPilot" className="logo-header" />
              <span className="model-selector-name">MicroPilot</span>
              <span className="model-selector-tag">MobileBERT</span>
              <ChevronDown size={14} />
            </button>

            {modelDropdownOpen && (
              <div className="nb-dropdown">
                <div className="dropdown-title">On-Device Edge Engine</div>
                <p className="dropdown-text">
                  Runs zero-shot classification locally in your browser/Android WebView via WASM. No cloud inference or external APIs.
                </p>
                <div className="dropdown-specs">
                  <div>Model: <strong>Xenova/mobilebert-uncased-mnli</strong></div>
                  <div>Artifact: <strong>~27 MB quantized ONNX</strong></div>
                </div>
                <button
                  className="nb-btn-primary full"
                  onClick={() => {
                    handleLoadModel()
                    setModelDropdownOpen(false)
                  }}
                >
                  {isModelReady() ? 'Reload Weights' : 'Preload Model'}
                </button>
              </div>
            )}
          </div>

          <div className="header-right">
            <span className={`nb-status-pill ${modelPillStatusClass(metrics.status)}`}>
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

            <span className={`nb-status-pill ${online ? 'online' : 'offline'}`}>
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              <span>{online ? 'Online' : 'Offline'}</span>
            </span>

            <button
              className="nb-icon-btn"
              onClick={() => setStatsModalOpen(true)}
              title="Edge Telemetry"
            >
              <BarChart3 size={17} />
            </button>

            <button
              className="nb-icon-btn mobile-only"
              onClick={handleNewChat}
              title="New Chat"
            >
              <Plus size={18} />
            </button>
          </div>
        </header>

        {/* ====================================================
            VIEW 1: NOTIFICATION RADAR
        ==================================================== */}
        {activeTab === 'radar' && (
          <div className="nb-scroll-area">
            <div className="nb-radar-container">
              <div className="radar-header-block">
                <div className="radar-title-row">
                  <img src="/logo.png" alt="MicroPilot" className="logo-radar" />
                  <div>
                    <h1 className="radar-heading">Notification Radar</h1>
                    <p className="radar-sub">
                      Automatically analyzes incoming notifications on-device and fires push triage reports.
                    </p>
                  </div>
                </div>

                {/* Permission & Environment Controls */}
                <div className="radar-controls-grid">
                  <div className="nb-control-card">
                    <div className="control-card-top">
                      <Smartphone size={16} />
                      <span className="control-card-label">OS Notification Listener</span>
                    </div>
                    {nativeAndroid ? (
                      <div className="control-card-row">
                        <span className={`nb-badge-flat ${nativeListenerEnabled ? 'ok' : 'warn'}`}>
                          {nativeListenerEnabled ? 'Listening Active' : 'Permission Needed'}
                        </span>
                        <button
                          className="nb-btn-primary small"
                          onClick={openAndroidNotificationSettings}
                        >
                          {nativeListenerEnabled ? 'Settings' : 'Grant Access'}
                        </button>
                      </div>
                    ) : (
                      <div className="control-card-row">
                        <span className="nb-badge-flat">Web Share Target Ready</span>
                        <span className="control-hint">
                          Share text from any Android app or build the native APK (`android/`) for auto-interception.
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="nb-control-card">
                    <div className="control-card-top">
                      <Bell size={16} />
                      <span className="control-card-label">Push Report Alerts</span>
                    </div>
                    <div className="control-card-row">
                      <span className={`nb-badge-flat ${pushGranted ? 'ok' : ''}`}>
                        {pushGranted ? 'Push Enabled' : 'Disabled'}
                      </span>
                      {!pushGranted && (
                        <button
                          className="nb-btn-primary small"
                          onClick={handleEnablePush}
                        >
                          Enable Push
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Simulate / Test Incoming Notification */}
              <div className="nb-sim-panel">
                <div className="sim-header">
                  <span>Test Incoming Notification Pipeline</span>
                  {analyzingNotif && (
                    <span className="sim-running">
                      {metrics.status === 'downloading'
                        ? `Downloading Model ${modelProgress}%…`
                        : 'Analyzing & Dispatching Push…'}
                    </span>
                  )}
                </div>

                <div className="sim-presets">
                  {SIMULATED_NOTIFICATIONS.map((item, idx) => (
                    <button
                      key={idx}
                      className="nb-sim-btn"
                      disabled={analyzingNotif}
                      onClick={() =>
                        processIncomingNotification({
                          ...item,
                          id: `sim_${Date.now()}_${idx}`,
                          timestamp: Date.now(),
                        })
                      }
                    >
                      <strong>{item.appName}:</strong> {item.title}
                    </button>
                  ))}
                </div>

                <form className="sim-custom-form" onSubmit={handleSimulateCustom}>
                  <input
                    type="text"
                    className="sim-app-input"
                    value={simApp}
                    onChange={(e) => setSimApp(e.target.value)}
                    placeholder="App"
                  />
                  <input
                    type="text"
                    className="sim-msg-input"
                    value={simText}
                    onChange={(e) => setSimText(e.target.value)}
                    placeholder="Simulate incoming notification text..."
                  />
                  <button
                    type="submit"
                    className="nb-btn-primary small"
                    disabled={!simText.trim() || analyzingNotif}
                  >
                    Analyze
                  </button>
                </form>
              </div>

              {error && <div className="nb-error-toast" style={{ marginTop: 12 }}>{error}</div>}

              {/* Live Reports Feed */}
              <div className="reports-feed-header">
                <span>Analyzed Reports ({reports.length})</span>
                {reports.length > 0 && (
                  <button className="nb-text-btn" onClick={handleClearReports}>
                    Clear Feed
                  </button>
                )}
              </div>

              {reports.length === 0 ? (
                <div className="nb-empty-reports">
                  <ShieldCheck size={28} />
                  <p>No notifications analyzed yet. Trigger a sample notification above or share text from another app.</p>
                </div>
              ) : (
                <div className="reports-list">
                  {reports.map((rep) => (
                    <div key={rep.id} className={`nb-report-card priority-${rep.priority.toLowerCase()}`}>
                      <div className="report-top-row">
                        <div className="report-badges">
                          <span className={`nb-priority-tag ${rep.priority.toLowerCase()}`}>
                            {rep.priority === 'RISK' && <ShieldAlert size={12} />}
                            <span>{rep.priority}</span>
                          </span>
                          <span className="report-app-name">{rep.notification.appName}</span>
                          <span className="report-time">
                            {new Date(rep.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <span className={`nb-exec-tag ${rep.fromCache ? 'cache' : 'ai'}`}>
                          {rep.fromCache ? 'Cache' : 'On-Device'} · {rep.inferenceMs} ms
                        </span>
                      </div>

                      <div className="report-source-text">
                        {rep.notification.title && <strong>{rep.notification.title}: </strong>}
                        {rep.notification.text}
                      </div>

                      <div className="report-analysis-strip">
                        <span>
                          Class: <strong>{rep.category}</strong> ({(rep.confidence * 100).toFixed(0)}%)
                        </span>
                        <span>·</span>
                        <span>
                          Tone: <strong style={{ textTransform: 'uppercase' }}>{rep.sentiment}</strong>
                        </span>
                        {rep.otpCode && (
                          <>
                            <span>·</span>
                            <span className="nb-kw-tag">OTP: {rep.otpCode}</span>
                          </>
                        )}
                        {rep.amounts.map((amt) => (
                          <span key={amt} className="nb-kw-tag">{amt}</span>
                        ))}
                        {rep.urls.length > 0 && <span className="nb-kw-tag">Link Detected</span>}
                      </div>

                      <div className="report-actions-row">
                        <button
                          className="nb-msg-action"
                          onClick={() => dispatchReportPushNotification(rep)}
                          title="Send push notification again"
                        >
                          <Bell size={13} />
                          <span style={{ marginLeft: 5, fontSize: '0.72rem' }}>Push Report</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====================================================
            VIEW 2: CHAT INTERFACE
        ==================================================== */}
        {activeTab === 'chat' && (
          <>
            <div className="nb-scroll-area">
              {(!activeSession || activeSession.messages.length === 0) && (
                <div className="nb-hero">
                  <img src="/logo.png" alt="MicroPilot" className="logo-hero" />
                  <h1 className="hero-heading">What text can I analyze?</h1>
                  <p className="hero-sub">
                    Private, zero-shot classification and sentiment analysis running 100% on-device.
                  </p>

                  <div className="nb-prompt-grid">
                    {SAMPLE_PROMPTS.map((sample, idx) => (
                      <button
                        key={idx}
                        className="nb-prompt-card"
                        onClick={() => handleSend(sample.prompt)}
                      >
                        <div className="prompt-title">{sample.title}</div>
                        <div className="prompt-snippet">“{sample.prompt}”</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeSession && activeSession.messages.length > 0 && (
                <div className="nb-messages">
                  {activeSession.messages.map((msg) => (
                    <MessageItem
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
                    <div className="msg-row assistant">
                      <img src="/logo.png" alt="MicroPilot" className="logo-avatar" />
                      <div className="msg-content">
                        <div className="thinking-inline">
                          <span className="thinking-square" />
                          <span>
                            {statusMsg ||
                              (metrics.status === 'downloading'
                                ? `Downloading MobileBERT (${modelProgress}%)…`
                                : metrics.status === 'initializing'
                                ? 'Initializing WASM runtime…'
                                : 'Analyzing on-device…')}
                          </span>
                        </div>
                        {metrics.status === 'downloading' && (
                          <div className="nb-progress-bar">
                            <div
                              className="nb-progress-fill"
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

            <div className="nb-dock-wrap">
              {error && <div className="nb-error-toast">{error}</div>}

              <div className="nb-input-bar">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Message MicroPilot..."
                  disabled={processing}
                />
                <button
                  className={`nb-send-btn ${input.trim() ? 'active' : ''}`}
                  onClick={() => handleSend()}
                  disabled={!input.trim() || processing}
                  title="Send"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              </div>

              <div className="nb-disclaimer">
                MicroPilot runs MobileBERT-MNLI locally in your browser. Prompts never leave your device.
              </div>
            </div>
          </>
        )}
      </div>

      {/* Telemetry & Settings Modal */}
      {statsModalOpen && (
        <div className="nb-modal-backdrop" onClick={() => setStatsModalOpen(false)}>
          <div className="nb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="nb-modal-header">
              <div className="modal-title">
                <Activity size={18} />
                <span>Edge Telemetry & Settings</span>
              </div>
              <button
                className="nb-icon-btn flat"
                onClick={() => setStatsModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="nb-modal-body">
              <div className="modal-group-title">Inference Engine</div>
              <div className="nb-stats-grid">
                <div className="nb-stat-box">
                  <div className="stat-k">Model</div>
                  <div className="stat-v">{metrics.modelName}</div>
                </div>
                <div className="nb-stat-box">
                  <div className="stat-k">Download</div>
                  <div className="stat-v">
                    {metrics.downloadDurationMs != null
                      ? `${(metrics.downloadDurationMs / 1000).toFixed(2)}s`
                      : '—'}
                  </div>
                </div>
                <div className="nb-stat-box">
                  <div className="stat-k">Init Time</div>
                  <div className="stat-v">
                    {metrics.initDurationMs != null ? `${metrics.initDurationMs} ms` : '—'}
                  </div>
                </div>
                <div className="nb-stat-box highlight">
                  <div className="stat-k">Last Latency</div>
                  <div className="stat-v">
                    {metrics.lastInferenceMs != null ? `${metrics.lastInferenceMs} ms` : '—'}
                  </div>
                </div>
                <div className="nb-stat-box">
                  <div className="stat-k">Avg AI Latency</div>
                  <div className="stat-v">
                    {metrics.avgInferenceMs != null ? `${metrics.avgInferenceMs} ms` : '—'}
                  </div>
                </div>
                <div className="nb-stat-box">
                  <div className="stat-k">Inferences / Local Ops</div>
                  <div className="stat-v">
                    {metrics.inferenceCount} / {metrics.localOpCount}
                  </div>
                </div>
              </div>

              <div className="modal-group-title" style={{ marginTop: 18 }}>
                IndexedDB Cache
              </div>
              <div className="nb-stats-grid">
                <div className="nb-stat-box">
                  <div className="stat-k">Hits / Misses</div>
                  <div className="stat-v">
                    {cacheStats.hits} / {cacheStats.misses}
                  </div>
                </div>
                <div className="nb-stat-box">
                  <div className="stat-k">Entries / Storage</div>
                  <div className="stat-v">
                    {cacheStats.entries} ({storageEst})
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="nb-btn-secondary" onClick={handleLoadModel}>
                  <Cpu size={15} />
                  <span>Reload Model Weights</span>
                </button>
                <button className="nb-btn-secondary danger" onClick={handleClearCache}>
                  <Database size={15} />
                  <span>Clear Inference Cache</span>
                </button>
                <button className="nb-btn-secondary danger" onClick={handleClearAllSessions}>
                  <Trash2 size={15} />
                  <span>Clear All Conversations</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function generateConversationalResponse(result: AnalysisResult): string {
  const intentLabel = result.intent ? result.intent.label : 'General'
  const intentConfidence = result.intent ? (result.intent.score * 100).toFixed(1) : '100'
  const sentimentLabel = result.sentiment ? result.sentiment.label : 'neutral'
  const sentimentConfidence = result.sentiment ? (result.sentiment.score * 100).toFixed(1) : '100'

  return `Intent: **${intentLabel}** (${intentConfidence}%) · Sentiment: **${sentimentLabel.toUpperCase()}** (${sentimentConfidence}%) · Complexity: **${result.stats.complexity}** (${result.stats.wordCount} words)`
}

function MessageItem({
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
      textToCopy += `\nIntent: ${result.intent?.label} (${(
        (result.intent?.score || 0) * 100
      ).toFixed(1)}%)\nSentiment: ${result.sentiment?.label}\nLatency: ${result.inferenceMs} ms`
    }
    navigator.clipboard.writeText(textToCopy).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (isUser) {
    return (
      <div className="msg-row user">
        <div className="nb-user-bubble">{message.content}</div>
      </div>
    )
  }

  return (
    <div className="msg-row assistant">
      <img src="/logo.png" alt="MicroPilot" className="logo-avatar" />

      <div className="msg-content">
        <div className="assistant-summary-line">
          {message.content.split('**').map((part, idx) =>
            idx % 2 === 1 ? <strong key={idx}>{part}</strong> : part
          )}
        </div>

        {result && (
          <div className="nb-analysis-box">
            {result.intent && (
              <div className="analysis-bars">
                {result.intent.allScores.slice(0, 4).map((s) => (
                  <div className="bar-row" key={s.label}>
                    <span className="bar-label">{s.label}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.round(s.score * 100)}%` }}
                      />
                    </div>
                    <span className="bar-pct">{(s.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}

            <div className="analysis-meta-strip">
              <div className="meta-left">
                <span>{result.stats.wordCount} words</span>
                <span>·</span>
                <span>{result.stats.charCount} chars</span>
                <span>·</span>
                <span>{result.stats.sentenceCount} sents</span>
                {result.stats.keywords.length > 0 && (
                  <>
                    <span>·</span>
                    <span className="keywords-inline">
                      {result.stats.keywords.slice(0, 5).map((k) => (
                        <span key={k} className="nb-kw-tag">
                          {k}
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </div>

              <div className="meta-right">
                <span className={`nb-exec-tag ${result.fromCache ? 'cache' : 'ai'}`}>
                  {result.fromCache ? 'Cache' : 'On-Device'} · {result.inferenceMs} ms
                </span>
                {result.fromCache && result.originalInferenceMs && (
                  <span className="saved-note">saved ~{result.originalInferenceMs} ms</span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="msg-actions">
          <button className="nb-msg-action" onClick={handleCopy} title="Copy">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            className="nb-msg-action"
            onClick={onReAnalyze}
            title="Re-run live inference"
          >
            <RotateCcw size={14} />
          </button>
          <button
            className={`nb-msg-action ${feedback === 'up' ? 'active' : ''}`}
            onClick={() => onFeedback('up')}
            title="Helpful"
          >
            <ThumbsUp size={14} />
          </button>
          <button
            className={`nb-msg-action ${feedback === 'down' ? 'active' : ''}`}
            onClick={() => onFeedback('down')}
            title="Not helpful"
          >
            <ThumbsDown size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
