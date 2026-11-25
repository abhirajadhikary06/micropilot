import { openDB, type IDBPDatabase } from 'idb'

export interface CacheEntry {
  id?: number
  text: string
  result: AnalysisResult
  timestamp: number
}

export interface AnalysisResult {
  intent: {
    label: string
    score: number
    allScores: { label: string; score: number }[]
  } | null
  sentiment: {
    label: string
    score: number
  } | null
  stats: {
    wordCount: number
    charCount: number
    sentenceCount: number
    keywords: string[]
    complexity: string
  }
  inferenceMs: number | null
  fromCache: boolean
  timestamp: number
}

export interface CacheStats {
  hits: number
  misses: number
  entries: number
}

const DB_NAME = 'micropilot-cache'
const STORE_NAME = 'results'
const MAX_ENTRIES = 50
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let dbPromise: Promise<IDBPDatabase> | null = null
let stats: CacheStats = { hits: 0, misses: 0, entries: 0 }

async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          })
          store.createIndex('text', 'text', { unique: false })
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }
      },
    })
  }
  return dbPromise
}

export async function getCached(text: string): Promise<AnalysisResult | null> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.store.index('text')
    const matches = await index.getAll(text)
    await tx.done

    if (matches.length === 0) {
      stats.misses++
      return null
    }

    // Prefer the most recent non-expired
    const now = Date.now()
    const valid = matches
      .filter((m) => now - m.timestamp < EXPIRY_MS)
      .sort((a, b) => b.timestamp - a.timestamp)

    if (valid.length === 0) {
      stats.misses++
      return null
    }

    stats.hits++
    const entry = valid[0]
    return { ...entry.result, fromCache: true }
  } catch (e) {
    console.warn('Cache read failed:', e)
    stats.misses++
    return null
  }
}

export async function setCached(text: string, result: AnalysisResult): Promise<void> {
  try {
    const db = await getDB()
    const entry: CacheEntry = {
      text,
      result: { ...result, fromCache: false },
      timestamp: Date.now(),
    }

    const tx = db.transaction(STORE_NAME, 'readwrite')
    await tx.store.add(entry)
    await tx.done

    // Prune if over limit
    await pruneOldEntries()
    stats.entries = await countEntries()
  } catch (e) {
    console.warn('Cache write failed:', e)
  }
}

async function pruneOldEntries() {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const all = await tx.store.getAll()
    const now = Date.now()

    // Delete expired
    for (const entry of all) {
      if (now - entry.timestamp >= EXPIRY_MS) {
        await tx.store.delete(entry.id!)
      }
    }

    // If still too many, delete oldest
    const remaining = await tx.store.getAll()
    if (remaining.length > MAX_ENTRIES) {
      remaining.sort((a, b) => a.timestamp - b.timestamp)
      const toDelete = remaining.slice(0, remaining.length - MAX_ENTRIES)
      for (const entry of toDelete) {
        await tx.store.delete(entry.id!)
      }
    }
    await tx.done
  } catch (e) {
    console.warn('Prune failed:', e)
  }
}

async function countEntries(): Promise<number> {
  try {
    const db = await getDB()
    return await db.count(STORE_NAME)
  } catch {
    return 0
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await getDB()
    await db.clear(STORE_NAME)
    stats = { hits: 0, misses: 0, entries: 0 }
  } catch (e) {
    console.warn('Clear cache failed:', e)
  }
}

export function getCacheStats(): CacheStats {
  return { ...stats }
}

export async function refreshCacheStats(): Promise<CacheStats> {
  stats.entries = await countEntries()
  return getCacheStats()
}

export async function estimateStorage(): Promise<string> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const est = await navigator.storage.estimate()
      const used = est.usage || 0
      if (used < 1024) return `${used} B`
      if (used < 1024 * 1024) return `${(used / 1024).toFixed(1)} KB`
      return `${(used / (1024 * 1024)).toFixed(2)} MB`
    } catch {
      return 'N/A'
    }
  }
  return 'N/A'
}
