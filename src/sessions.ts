import { randomUUID } from "node:crypto"
import type { Config, Session } from "./types.ts"

// Sessions expire after 30 minutes of inactivity
const SESSION_INACTIVITY_MS = 30 * 60 * 1000

interface SessionEntry {
  session: Session
  lastActive: number
}

const store = new Map<string, SessionEntry>()

export function createSession(systemPrompt: string, config: Config): Session {
  cleanExpired()
  const session: Session = {
    id: randomUUID(),
    systemPrompt,
    messages: [],
    config,
    aisp_current: undefined,
  }
  store.set(session.id, { session, lastActive: Date.now() })
  return session
}

export function getSession(id: string): Session {
  cleanExpired()
  const entry = store.get(id)
  if (!entry) {
    throw new Error(
      `Session ${id} not found or expired. Start a new session with purify_run.`,
    )
  }
  entry.lastActive = Date.now()
  return entry.session
}

export function saveSession(session: Session): void {
  const entry = store.get(session.id)
  if (entry) {
    entry.session = session
    entry.lastActive = Date.now()
  }
}

function cleanExpired(): void {
  const now = Date.now()
  for (const [id, entry] of store) {
    if (now - entry.lastActive > SESSION_INACTIVITY_MS) {
      store.delete(id)
    }
  }
}
