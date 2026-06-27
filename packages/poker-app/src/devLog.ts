// Module-level log store — usable from transports (non-React) and components alike.

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  msg: string
}

let counter = 0
const entries: LogEntry[] = []
const listeners = new Set<() => void>()

export function devLog(level: LogLevel, msg: string): void {
  const entry: LogEntry = { id: counter++, ts: Date.now(), level, msg }
  entries.push(entry)
  console[level === 'debug' ? 'log' : level](`[${level.toUpperCase()}] ${msg}`)
  listeners.forEach((fn) => fn())
}

export function getDevLogs(): readonly LogEntry[] { return entries }
export function clearDevLogs(): void { entries.length = 0; listeners.forEach((fn) => fn()) }
export function subscribeDevLogs(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
