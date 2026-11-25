import type { AnalysisResult } from './cache'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  result?: AnalysisResult
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

const STORAGE_KEY = 'micropilot_chat_sessions_v1'
const ACTIVE_SESSION_KEY = 'micropilot_active_session_id'

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error('Failed to load sessions:', e)
    return []
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch (e) {
    console.error('Failed to save sessions:', e)
  }
}

export function getActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY)
  } catch {
    return null
  }
}

export function setActiveSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, id)
  } catch {
    // Ignore storage errors
  }
}

export function createNewSession(initialTitle = 'New Chat'): ChatSession {
  return {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: initialTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
}
