import { useState, useEffect, useCallback, useRef } from 'react'
import {
  loadModel,
  getMetrics,
  isModelReady,
  type ModelStatus,
  type ModelMetrics,
} from './model'
import { analyzeText, transformText } from './processor'
import {
  clearCache,
  getCacheStats,
  refreshCacheStats,
  estimateStorage,
  type AnalysisResult,
  type CacheStats,
} from './cache'

interface HistoryItem {
  id: string
  text: string
  result: AnalysisResult
}

function App() {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<ModelMetrics>(getMetrics())
  const [cacheStats, setCacheStats] = useState<CacheStats>({ hits: 0, misses: 0, entries: 0 })
  const [storageEst, setStorageEst] = useState('N/A')
  const [online, setOnline] = useState(navigator.onLine)
  const [modelProgress, setModelProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const refreshMetrics = useCallback(() => {
    setMetrics(getMetrics())
    setCacheStats(getCacheStats())
  }, [])

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
      setError(e?.message || 'Failed to load model')
      setMetrics(getMetrics())
    }
  }

  const handleAnalyze = async () => {
    const text = input.trim()
    if (!text || processing) return

    setProcessing(true)
    setError(null)

    try {
      // Auto-load model on first AI use
      if (!isModelReady()) {
        await handleLoadModel()
      }

      const result = await analyzeText(text, {
        doIntent: true,
        doSentiment: true,
      })

      const item: HistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        result,
      }
      setHistory((prev) => [item, ...prev].slice(0, 30))
      setInput('')
      refreshMetrics()
      setCacheStats(getCacheStats())
      estimateStorage().then(setStorageEst)
    } catch (e: any) {
      setError(e?.message || 'Analysis failed')
    } finally {
      setProcessing(false)
      refreshMetrics()
    }
  }

  const handleTransform = (op: 'uppercase' | 'lowercase' | 'trim' | 'collapse') => {
    if (!input.trim()) return
    const out = transformText(input, op)
    setInput(out)
    refreshMetrics()
  }

  const handleClearHistory = () => {
    setHistory([])
  }

  const handleClearCache = async () => {
    await clearCache()
    setCacheStats({ hits: 0, misses: 0, entries: 0 })
    estimateStorage().then(setStorageEst)
  }

  const copyResult = (item: HistoryItem) => {
    const r = item.result
    const lines = [
      `Input: ${item.text}`,
      r.intent ? `Intent: ${r.intent.label} (${(r.intent.score * 100).toFixed(1)}%)` : '',
      r.sentiment ? `Sentiment: ${r.sentiment.label} (${(r.sentiment.score * 100).toFixed(1)}%)` : '',
      `Words: ${r.stats.wordCount} | Chars: ${r.stats.charCount} | Sentences: ${r.stats.sentenceCount}`,
      `Complexity: ${r.stats.complexity}`,
      r.stats.keywords.length ? `Keywords: ${r.stats.keywords.join(', ')}` : '',
      r.inferenceMs != null ? `Inference: ${r.inferenceMs} ms` : '',
      r.fromCache ? 'Source: Cache' : 'Source: On-device AI',
    ].filter(Boolean)
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
  }

  const statusClass = (s: ModelStatus) => {
    if (s === 'ready') return 'ready'
    if (s === 'error') return 'error'
    if (s === 'downloading' || s === 'initializing') return 'downloading'
    return ''
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-mark">M</div>
          <span>MicroPilot</span>
        </div>
        <div className="status-pills">
          <span className={`pill ${statusClass(metrics.status)}`}>
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
          <span className={`pill ${online ? 'online' : 'offline'}`}>
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
      </header>

      <main className="main">
        <p className="intro">
          <strong>Edge-only AI assistant.</strong> MobileBERT-MNLI runs entirely in your browser.
          No cloud inference. Text classification, sentiment, and local utilities only.
        </p>

        {/* Input */}
        <div className="input-area">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type or paste text to analyze locally…"
            disabled={processing}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleAnalyze()
              }
            }}
          />
          <div className="input-actions">
            <button
              className="btn primary"
              onClick={handleAnalyze}
              disabled={processing || !input.trim()}
            >
              {processing ? (
                <>
                  <span className="spinner" /> Analyzing…
                </>
              ) : (
                'Analyze'
              )}
            </button>
            <button className="btn ghost" onClick={() => handleTransform('uppercase')} disabled={!input}>
              UPPER
            </button>
            <button className="btn ghost" onClick={() => handleTransform('lowercase')} disabled={!input}>
              lower
            </button>
            <button className="btn ghost" onClick={() => handleTransform('collapse')} disabled={!input}>
              Clean
            </button>
          </div>
          {(metrics.status === 'downloading' || metrics.status === 'initializing') && (
            <div>
              <div className="note">{statusMsg}</div>
              <div className="progress-wrap">
                <div className="progress-bar" style={{ width: `${modelProgress}%` }} />
              </div>
            </div>
          )}
        </div>

        {error && <div className="error-box">{error}</div>}

        {/* Results */}
        <div className="results">
          {history.length === 0 && !processing && (
            <div className="empty">
              Submit text to run local zero-shot classification + utilities.
              <br />
              <span className="note">
                First run downloads the ~27 MB quantized MobileBERT model (cached afterwards).
              </span>
            </div>
          )}

          <div className="history">
            {history.map((item) => (
              <ResultCard key={item.id} item={item} onCopy={() => copyResult(item)} />
            ))}
          </div>
        </div>

        {/* Performance Dashboard */}
        <div className="dashboard">
          <div className="dashboard-title">Edge Performance</div>
          <div className="metrics-grid">
            <div className="metric">
              <div className="metric-label">Model</div>
              <div className="metric-value">{metrics.modelName}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Artifact</div>
              <div className="metric-value" style={{ fontSize: '0.7rem' }}>
                {metrics.artifact}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Download</div>
              <div className="metric-value">
                {metrics.downloadDurationMs != null
                  ? `${(metrics.downloadDurationMs / 1000).toFixed(1)}s`
                  : '—'}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Init</div>
              <div className="metric-value">
                {metrics.initDurationMs != null ? `${metrics.initDurationMs} ms` : '—'}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Last latency</div>
              <div className="metric-value">
                {metrics.lastInferenceMs != null ? `${metrics.lastInferenceMs} ms` : '—'}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Avg latency</div>
              <div className="metric-value">
                {metrics.avgInferenceMs != null ? `${metrics.avgInferenceMs} ms` : '—'}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">AI inferences</div>
              <div className="metric-value">{metrics.inferenceCount}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Local ops</div>
              <div className="metric-value">{metrics.localOpCount}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Cache hits / misses</div>
              <div className="metric-value">
                {cacheStats.hits} / {cacheStats.misses}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Cache entries</div>
              <div className="metric-value">{cacheStats.entries}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Est. storage</div>
              <div className="metric-value">{storageEst}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Status</div>
              <div className="metric-value">{metrics.status}</div>
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="settings">
          <button className="btn" onClick={handleLoadModel} disabled={metrics.status === 'downloading' || metrics.status === 'initializing'}>
            {isModelReady() ? 'Reload Model' : 'Load Model'}
          </button>
          <button className="btn ghost" onClick={handleClearHistory} disabled={history.length === 0}>
            Clear Conversation
          </button>
          <button className="btn ghost danger" onClick={handleClearCache}>
            Clear Cache
          </button>
        </div>

        <p className="note">
          MicroPilot performs local zero-shot classification and deterministic text utilities.
          It does not generate free-form answers or summaries. All processing stays on-device.
        </p>
      </main>

      <footer>
        MicroPilot · Edge AI · MobileBERT-MNLI · No cloud inference
      </footer>
    </div>
  )
}

function ResultCard({
  item,
  onCopy,
}: {
  item: HistoryItem
  onCopy: () => void
}) {
  const { result } = item
  const time = new Date(result.timestamp).toLocaleTimeString()

  return (
    <div className="result-card">
      <div className="result-header">
        <div className="result-query">{item.text}</div>
        <div className="meta">{time}</div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {result.fromCache ? (
          <span className="badge cache">Cache</span>
        ) : result.intent ? (
          <span className="badge ai">On-device AI</span>
        ) : (
          <span className="badge local">Local</span>
        )}
        {result.inferenceMs != null && (
          <span className="meta">{result.inferenceMs} ms</span>
        )}
      </div>

      {result.intent && (
        <div>
          <div className="section-title">Intent classification</div>
          <div className="intent-label">{result.intent.label}</div>
          <div className="confidence">
            Confidence {(result.intent.score * 100).toFixed(1)}%
          </div>
          <div className="scores-list">
            {result.intent.allScores.slice(0, 5).map((s) => (
              <div className="score-row" key={s.label}>
                <span style={{ minWidth: 120 }}>{s.label}</span>
                <div className="score-bar">
                  <div style={{ width: `${Math.round(s.score * 100)}%` }} />
                </div>
                <span style={{ minWidth: 42, textAlign: 'right' }}>
                  {(s.score * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.sentiment && (
        <div>
          <div className="section-title">Sentiment</div>
          <div>
            <strong style={{ textTransform: 'capitalize' }}>{result.sentiment.label}</strong>
            <span className="confidence"> · {(result.sentiment.score * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}

      <div>
        <div className="section-title">Text statistics (local)</div>
        <div className="stats-grid">
          <div className="stat">
            <div className="stat-label">Words</div>
            <div className="stat-value">{result.stats.wordCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Chars</div>
            <div className="stat-value">{result.stats.charCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Sentences</div>
            <div className="stat-value">{result.stats.sentenceCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Complexity</div>
            <div className="stat-value">{result.stats.complexity}</div>
          </div>
        </div>
        {result.stats.keywords.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="section-title">Keywords</div>
            <div className="keywords">
              {result.stats.keywords.map((k) => (
                <span className="keyword" key={k}>
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <button className="btn ghost" onClick={onCopy} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
          Copy result
        </button>
      </div>
    </div>
  )
}

export default App
