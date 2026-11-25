import { pipeline, env, type ZeroShotClassificationPipeline } from '@huggingface/transformers'

// Configure Transformers.js for browser / edge / Android WebView use
env.allowLocalModels = false
env.useBrowserCache = true
if (env.backends?.onnx?.wasm) {
  const canUseThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  env.backends.onnx.wasm.proxy = canUseThreads
  if (!canUseThreads) {
    env.backends.onnx.wasm.numThreads = 1
  }
}

const MODEL_ID = 'Xenova/mobilebert-uncased-mnli'
const DEFAULT_DTYPE = 'q8' as const

export type ModelStatus =
  | 'idle'
  | 'downloading'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'unsupported'

export interface ModelMetrics {
  modelName: string
  modelId: string
  artifact: string
  downloadDurationMs: number | null
  initDurationMs: number | null
  lastInferenceMs: number | null
  avgInferenceMs: number | null
  inferenceCount: number
  localOpCount: number
  status: ModelStatus
  errorMessage: string | null
  progress: number
}

const INTENT_LABELS = [
  'Question',
  'Request for information',
  'Text transformation',
  'Sentiment analysis',
  'Information extraction',
  'Technical question',
  'General conversation',
  'Complex reasoning request',
]

export const NOTIFICATION_LABELS = [
  'Urgent action required',
  'Security alert or OTP',
  'Financial or bank transaction',
  'Important personal message',
  'Routine update or delivery',
  'Promotional spam or marketing',
  'Potential phishing or scam',
]

const SENTIMENT_LABELS = ['positive', 'negative', 'neutral']

let classifier: ZeroShotClassificationPipeline | null = null
let metrics: ModelMetrics = {
  modelName: 'MobileBERT-MNLI',
  modelId: MODEL_ID,
  artifact: 'onnx/model_quantized.onnx (~27 MB)',
  downloadDurationMs: null,
  initDurationMs: null,
  lastInferenceMs: null,
  avgInferenceMs: null,
  inferenceCount: 0,
  localOpCount: 0,
  status: 'idle',
  errorMessage: null,
  progress: 0,
}

let totalInferenceMs = 0
let loadPromise: Promise<void> | null = null

type ProgressCallback = (status: ModelStatus, progress: number, message?: string) => void

export function getMetrics(): ModelMetrics {
  return { ...metrics }
}

export function getIntentLabels() {
  return [...INTENT_LABELS]
}

export function getSentimentLabels() {
  return [...SENTIMENT_LABELS]
}

export async function loadModel(onProgress?: ProgressCallback): Promise<void> {
  if (classifier) {
    metrics.status = 'ready'
    onProgress?.('ready', 100)
    return
  }

  if (loadPromise) {
    return loadPromise
  }

  loadPromise = (async () => {
    try {
      metrics.status = 'downloading'
      metrics.progress = 0
      metrics.errorMessage = null
      onProgress?.('downloading', 0, 'Starting model download…')

      const downloadStart = performance.now()

      const pipe = await pipeline(
        'zero-shot-classification',
        MODEL_ID,
        {
          dtype: DEFAULT_DTYPE,
          progress_callback: (data: any) => {
            if (data.status === 'progress' && data.progress != null) {
              const p = Math.min(99, Math.round(data.progress))
              metrics.progress = p
              metrics.status = 'downloading'
              onProgress?.('downloading', p, data.file || 'Downloading…')
            } else if (data.status === 'done') {
              metrics.progress = 95
              onProgress?.('downloading', 95, 'Download complete, initializing…')
            }
          },
        }
      )

      const downloadEnd = performance.now()
      metrics.downloadDurationMs = Math.round(downloadEnd - downloadStart)

      metrics.status = 'initializing'
      metrics.progress = 98
      onProgress?.('initializing', 98, 'Warming up model…')

      const initStart = performance.now()
      // Warm-up inference with a short text
      await (pipe as any)('Hello world', INTENT_LABELS.slice(0, 3))
      const initEnd = performance.now()
      metrics.initDurationMs = Math.round(initEnd - initStart)

      classifier = pipe as ZeroShotClassificationPipeline
      metrics.status = 'ready'
      metrics.progress = 100
      onProgress?.('ready', 100, 'Model ready')
    } catch (err: any) {
      console.error('Model load failed:', err)
      metrics.status = 'error'
      metrics.errorMessage = err?.message || String(err)
      metrics.progress = 0
      classifier = null
      loadPromise = null
      onProgress?.('error', 0, metrics.errorMessage || 'Load failed')
      throw err
    }
  })()

  return loadPromise
}

export function isModelReady(): boolean {
  return classifier != null && metrics.status === 'ready'
}

export async function classifyIntent(
  text: string,
  candidateLabels: string[] = INTENT_LABELS
): Promise<{ label: string; score: number; allScores: { label: string; score: number }[] }> {
  if (!classifier) {
    throw new Error('Model not loaded')
  }

  const start = performance.now()
  const result: any = await classifier(text, candidateLabels, {
    multi_label: false,
  })
  const end = performance.now()
  const latency = Math.round(end - start)

  metrics.lastInferenceMs = latency
  metrics.inferenceCount += 1
  totalInferenceMs += latency
  metrics.avgInferenceMs = Math.round(totalInferenceMs / metrics.inferenceCount)

  // Normalize result shape from Transformers.js
  const data = Array.isArray(result) ? result[0] : result
  let labels: string[] = []
  let scores: number[] = []

  if (data?.labels && data?.scores) {
    labels = data.labels
    scores = data.scores
  } else if (Array.isArray(result) && result[0]?.label) {
    labels = result.map((r: any) => r.label)
    scores = result.map((r: any) => r.score)
  } else {
    throw new Error('Unexpected classification result shape')
  }

  const allScores = labels.map((label, i) => ({
    label,
    score: scores[i] ?? 0,
  })).sort((a, b) => b.score - a.score)

  return {
    label: allScores[0]?.label ?? 'Unknown',
    score: allScores[0]?.score ?? 0,
    allScores,
  }
}

export async function classifySentiment(
  text: string
): Promise<{ label: string; score: number }> {
  if (!classifier) {
    throw new Error('Model not loaded')
  }

  const start = performance.now()
  const result: any = await classifier(text, SENTIMENT_LABELS, {
    multi_label: false,
  })
  const end = performance.now()
  const latency = Math.round(end - start)

  metrics.lastInferenceMs = latency
  metrics.inferenceCount += 1
  totalInferenceMs += latency
  metrics.avgInferenceMs = Math.round(totalInferenceMs / metrics.inferenceCount)

  const data = Array.isArray(result) ? result[0] : result
  let labels: string[] = []
  let scores: number[] = []

  if (data?.labels && data?.scores) {
    labels = data.labels
    scores = data.scores
  } else if (Array.isArray(result) && result[0]?.label) {
    labels = result.map((r: any) => r.label)
    scores = result.map((r: any) => r.score)
  } else {
    throw new Error('Unexpected classification result shape')
  }

  const bestIdx = scores.length > 0 ? scores.indexOf(Math.max(...scores)) : 0
  return {
    label: labels[bestIdx] ?? 'neutral',
    score: scores[bestIdx] ?? 0,
  }
}

export function incrementLocalOp() {
  metrics.localOpCount += 1
}

export function recordLatency(latencyMs: number) {
  metrics.lastInferenceMs = latencyMs
}

export async function unloadModel() {
  classifier = null
  loadPromise = null
  metrics.status = 'idle'
  metrics.progress = 0
  metrics.errorMessage = null
}
