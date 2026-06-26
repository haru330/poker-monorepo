import type { GameState } from 'poker-engine'
import type { ClientMessage, QRPayload, ServerMessage, Transport } from './types'

const SESSION_KEY = 'poker-session-token'
const NAME_KEY    = 'poker-username'

function token(): string {
  let t = localStorage.getItem(SESSION_KEY)
  if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(SESSION_KEY, t) }
  return t
}

export interface WSHostOptions {
  serverUrl: string                          // e.g. "wss://poker.example.com"
  onState: (s: GameState) => void
  onQR: (payload: QRPayload) => void         // show this as a QR code on host screen
  onError: (reason: string) => void
}

export interface WSGuestOptions {
  payload: QRPayload & { mode: 'ws' }        // decoded from scanned QR
  name: string
  onState: (s: GameState) => void
  onRejected: (reason: string) => void
}

// ── Host ──────────────────────────────────────────────────────────────────

export class WSHostTransport implements Transport {
  readonly role = 'host' as const
  connected = false
  private ws: WebSocket

  constructor(opts: WSHostOptions) {
    this.ws = new WebSocket(`${opts.serverUrl}/create`)

    this.ws.onopen = () => {
      this.connected = true
      const name = localStorage.getItem(NAME_KEY) ?? 'Host'
      const msg: ClientMessage = { type: 'JOIN', name, sessionToken: token() }
      this.ws.send(JSON.stringify(msg))
    }

    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage
      switch (msg.type) {
        case 'ROOM_CREATED':
          // Produce the QR payload guests will scan
          opts.onQR({ mode: 'ws', url: `${opts.serverUrl}/join/${msg.roomCode}`, roomCode: msg.roomCode })
          break
        case 'STATE':
          opts.onState(msg.state)
          break
        case 'JOIN_REJECTED':
          opts.onError(msg.reason)
          break
      }
    }

    this.ws.onerror = () => opts.onError('connection failed')
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]): void {
    this.send({ type: 'ACTION', action })
  }

  startGame(): void { this.send({ type: 'START_GAME' }) }
  nextHand(): void  { this.send({ type: 'NEXT_HAND' }) }

  leave(): void {
    this.connected = false
    this.ws.close()
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }
}

// ── Guest ─────────────────────────────────────────────────────────────────

export class WSGuestTransport implements Transport {
  readonly role = 'guest' as const
  connected = false
  private ws: WebSocket

  constructor(opts: WSGuestOptions) {
    this.ws = new WebSocket(opts.payload.url)

    this.ws.onopen = () => {
      this.connected = true
      const msg: ClientMessage = { type: 'JOIN', name: opts.name, sessionToken: token() }
      this.ws.send(JSON.stringify(msg))
    }

    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage
      switch (msg.type) {
        case 'STATE':       opts.onState(msg.state); break
        case 'JOIN_REJECTED': opts.onRejected(msg.reason); break
      }
    }
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]): void {
    this.send({ type: 'ACTION', action })
  }

  startGame(): void { this.send({ type: 'START_GAME' }) }
  nextHand(): void  { this.send({ type: 'NEXT_HAND' }) }

  leave(): void {
    this.connected = false
    this.ws.close()
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }
}
