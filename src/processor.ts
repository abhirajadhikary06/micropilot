import {
  loadModel,
  isModelReady,
  classifyIntent,
  classifySentiment,
  incrementLocalOp,
  getMetrics,
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
    const cached = await getCached(normalized)
    if (cached) {
      return cached
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
