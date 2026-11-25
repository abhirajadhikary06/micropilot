import {
  loadModel,
  isModelReady,
  classifyIntent,
  classifySentiment,
  incrementLocalOp,
  recordLatency,
  getMetrics,
  NOTIFICATION_LABELS,
} from './model'
import { getCached, setCached, type AnalysisResult } from './cache'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'up', 'about', 'into', 'over', 'after', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'what', 'which',
  'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
])

function computeStats(text: string) {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const charCount = trimmed.length
  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  const sentenceCount = Math.max(1, sentences.length)

  // Simple keyword extraction: top non-stop words by frequency
  const freq = new Map<string, number>()
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (lower.length < 3 || STOP_WORDS.has(lower)) continue
    freq.set(lower, (freq.get(lower) || 0) + 1)
  }
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k)

  // Complexity heuristic (deterministic)
  const avgWordLen = wordCount ? words.reduce((s, w) => s + w.length, 0) / wordCount : 0
  const avgSentLen = wordCount / sentenceCount
  let complexity = 'Simple'
  if (avgSentLen > 22 || avgWordLen > 6.5 || wordCount > 120) {
    complexity = 'Complex'
  } else if (avgSentLen > 14 || avgWordLen > 5 || wordCount > 50) {
    complexity = 'Moderate'
  }

  incrementLocalOp()
  return { wordCount, charCount, sentenceCount, keywords, complexity }
}

export async function analyzeText(
  text: string,
  options: {
    doIntent?: boolean
    doSentiment?: boolean
    forceRefresh?: boolean
  } = {}
): Promise<AnalysisResult> {
  const {
    doIntent = true,
    doSentiment = true,
    forceRefresh = false,
  } = options

  const normalized = text.trim()
  if (!normalized) {
    throw new Error('Empty text')
  }

  // Exact-match cache
  if (!forceRefresh) {
    const cacheStart = performance.now()
    const cached = await getCached(normalized)
    if (cached) {
      const cacheEnd = performance.now()
      const cacheLatency = Math.max(1, Math.round(cacheEnd - cacheStart))
      recordLatency(cacheLatency)
      return {
        ...cached,
        originalInferenceMs: cached.originalInferenceMs ?? cached.inferenceMs,
        inferenceMs: cacheLatency,
        fromCache: true,
        timestamp: Date.now(),
      }
    }
  }

  // Ensure model is loaded if AI features requested
  const needsAI = doIntent || doSentiment
  if (needsAI && !isModelReady()) {
    await loadModel()
  }

  let intent = null
  let sentiment = null
  let inferenceMs: number | null = null

  const start = performance.now()

  if (doIntent) {
    intent = await classifyIntent(normalized)
  }
  if (doSentiment) {
    sentiment = await classifySentiment(normalized)
  }

  const end = performance.now()
  if (needsAI) {
    inferenceMs = Math.round(end - start)
  }

  const stats = computeStats(normalized)

  const result: AnalysisResult = {
    intent,
    sentiment,
    stats,
    inferenceMs,
    fromCache: false,
    timestamp: Date.now(),
  }

  // Cache successful AI results
  if (needsAI) {
    await setCached(normalized, result)
  }

  return result
}

export function transformText(
  text: string,
  op: 'uppercase' | 'lowercase' | 'trim' | 'collapse'
): string {
  incrementLocalOp()
  switch (op) {
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'trim':
      return text.trim()
    case 'collapse':
      return text.replace(/\s+/g, ' ').trim()
    default:
      return text
  }
}

export function getModelStatus() {
  return getMetrics()
}

export interface IncomingNotification {
  id: string
  packageName: string
  appName: string
  title: string
  text: string
  timestamp: number
}

export type NotificationPriority = 'URGENT' | 'RISK' | 'IMPORTANT' | 'ROUTINE' | 'SPAM'

export interface NotificationReport {
  id: string
  notification: IncomingNotification
  priority: NotificationPriority
  category: string
  confidence: number
  sentiment: string
  sentimentScore: number
  otpCode: string | null
  amounts: string[]
  urls: string[]
  summaryTitle: string
  summaryBody: string
  inferenceMs: number
  originalInferenceMs?: number | null
  fromCache: boolean
  timestamp: number
}

function extractEntities(text: string) {
  const lower = text.toLowerCase()
  const hasOtpContext = /\b(otp|code|pin|passcode|verify|verification|2fa)\b/i.test(lower)
  const otpMatch = hasOtpContext ? text.match(/\b(\d{4,8})\b/) : null
  const otpCode = otpMatch ? otpMatch[1] : null

  const amountMatches = text.match(/(?:₹|Rs\.?|\$|€|£|INR|USD)\s?[\d,]+(?:\.\d{1,2})?/gi) || []
  const urlMatches = text.match(/https?:\/\/[^\s]+/gi) || []

  incrementLocalOp()
  return {
    otpCode,
    amounts: Array.from(new Set(amountMatches)),
    urls: Array.from(new Set(urlMatches)),
  }
}

function mapCategoryToPriority(category: string): NotificationPriority {
  switch (category) {
    case 'Potential phishing or scam':
      return 'RISK'
    case 'Urgent action required':
    case 'Security alert or OTP':
      return 'URGENT'
    case 'Financial or bank transaction':
    case 'Important personal message':
      return 'IMPORTANT'
    case 'Promotional spam or marketing':
      return 'SPAM'
    default:
      return 'ROUTINE'
  }
}

export async function analyzeNotification(
  notification: IncomingNotification
): Promise<NotificationReport> {
  const combined = `${notification.title ? notification.title + ': ' : ''}${notification.text}`.trim()
  if (!combined) {
    throw new Error('Empty notification text')
  }

  const cacheKey = `notif:${combined}`
  const entities = extractEntities(combined)

  const cacheStart = performance.now()
  const cached = await getCached(cacheKey)
  let category = 'Routine update or delivery'
  let confidence = 0
  let sentiment = 'neutral'
  let sentimentScore = 0
  let inferenceMs = 1
  let originalInferenceMs: number | null | undefined = null
  let fromCache = false

  if (cached && cached.intent && cached.sentiment) {
    const cacheEnd = performance.now()
    inferenceMs = Math.max(1, Math.round(cacheEnd - cacheStart))
    originalInferenceMs = cached.originalInferenceMs ?? cached.inferenceMs
    recordLatency(inferenceMs)
    category = cached.intent.label
    confidence = cached.intent.score
    sentiment = cached.sentiment.label
    sentimentScore = cached.sentiment.score
    fromCache = true
  } else {
    if (!isModelReady()) {
      await loadModel()
    }
    const start = performance.now()
    const intentRes = await classifyIntent(combined, NOTIFICATION_LABELS)
    const sentRes = await classifySentiment(combined)
    const end = performance.now()
    inferenceMs = Math.max(1, Math.round(end - start))

    category = intentRes.label
    confidence = intentRes.score
    sentiment = sentRes.label
    sentimentScore = sentRes.score

    const stats = computeStats(combined)
    await setCached(cacheKey, {
      intent: intentRes,
      sentiment: sentRes,
      stats,
      inferenceMs,
      fromCache: false,
      timestamp: Date.now(),
    })
  }

  const priority = mapCategoryToPriority(category)
  const confPct = (confidence * 100).toFixed(0)

  const parts: string[] = []
  if (entities.otpCode) parts.push(`OTP: ${entities.otpCode}`)
  if (entities.amounts.length > 0) parts.push(`Amount: ${entities.amounts[0]}`)
  if (entities.urls.length > 0) parts.push(`Link detected`)
  parts.push(`${sentiment.toUpperCase()} (${confPct}% conf)`)
  parts.push(`${inferenceMs} ms on-device`)

  const summaryTitle = `[${priority}] ${notification.appName} - ${category}`
  const summaryBody = `${parts.join(' | ')}\n${combined.slice(0, 110)}${combined.length > 110 ? '...' : ''}`

  return {
    id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    notification,
    priority,
    category,
    confidence,
    sentiment,
    sentimentScore,
    otpCode: entities.otpCode,
    amounts: entities.amounts,
    urls: entities.urls,
    summaryTitle,
    summaryBody,
    inferenceMs,
    originalInferenceMs,
    fromCache,
    timestamp: Date.now(),
  }
}
