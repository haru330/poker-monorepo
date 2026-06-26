import Peer, { type DataConnection } from 'peerjs'
import type { GameState } from 'poker-engine'
import { dealNewHand, applyAction } from 'poker-engine'
import type { ClientMessage, QRPayload, ServerMessage, Transport } from './types'

const STUN = { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } }

const SESSION_KEY = 'poker-session-token'
const NAME_KEY    = 'poker-username'

function sessionToken(): string {
  let t = localStorage.getItem(SESSION_KEY)
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, t) }
  return t
}

function generateRoomCode(): string {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * 26)]).join('')
}

function createPlayer(id: string, name: string, chips: number, isHost: boolean) {
  return {
    id, name, chips, hand: [] as never[],
    status: 'connected' as const, hasFolded: false,
    isAllIn: false, isHost,
    streetContribution: 0, totalContribution: 0, hasActed: false,
  }
}

function stripSuffix(name: string) { return name.replace(/ \([AB]\)$/, '') }

const INITIAL_STATE: GameState = {
  roomCode: '',
  players: [], deck: [], communityCards: [],
  street: 'preflop', pots: [],
  dealerButtonIndex: -1, currentTurnPlayerId: null,
  currentBet: 0, minRaise: 0,
  startingChips: 100, bigBlind: 2,
  actionLog: [], results: null,
}

// ── Host ──────────────────────────────────────────────────────────────────

export interface PeerHostOptions {
  hostName: string
  onState:  (s: GameState) => void
  onQR:     (payload: QRPayload) => void
  onError:  (reason: string) => void
}

export class PeerHostTransport implements Transport {
  readonly role = 'host' as const
  connected = true

  private peer: Peer
  private conns   = new Map<string, DataConnection>() // connId → conn
  private connPid = new Map<string, string>()         // connId → playerId
  private state: GameState

  constructor(private opts: PeerHostOptions) {
    const roomCode = generateRoomCode()
    this.state = { ...INITIAL_STATE, roomCode }
    this.peer  = new Peer(roomCode, STUN)

    this.peer.on('open', (id) => {
      // Add host as first player
      const token = sessionToken()
      localStorage.setItem('poker-username', opts.hostName)
      const player = createPlayer(token, opts.hostName, this.state.startingChips, true)
      this.state = { ...this.state, players: [player] }
      opts.onState(this.state)
      opts.onQR({ mode: 'peer', peerId: id })
    })
    this.peer.on('connection', (conn) => this.onConnection(conn))
    this.peer.on('error', (e) => opts.onError(String(e)))
  }

  private onConnection(conn: DataConnection) {
    this.conns.set(conn.connectionId, conn)
    conn.on('data',  (d) => this.handleMessage(conn, d as ClientMessage))
    conn.on('close', ()  => this.handleDisconnect(conn))
  }

  private handleMessage(conn: DataConnection, msg: ClientMessage) {
    switch (msg.type) {
      case 'JOIN': {
        const existing = this.state.players.find((p) => p.id === msg.sessionToken)
        if (existing) {
          this.connPid.set(conn.connectionId, msg.sessionToken)
          this.state = { ...this.state, players: this.state.players.map((p) =>
            p.id === msg.sessionToken ? { ...p, status: 'connected' } : p) }
          this.send(conn, { type: 'JOIN_OK', sessionToken: msg.sessionToken })
          this.broadcastState(); return
        }
        if (this.state.players.length >= 8) {
          this.send(conn, { type: 'JOIN_REJECTED', reason: 'table is full' }); return
        }
        const base = msg.name.trim()
        const same = this.state.players.filter((p) => base === stripSuffix(p.name))
        if (same.length >= 2) {
          this.send(conn, { type: 'JOIN_REJECTED', reason: 'name taken, try another' }); return
        }
        let players = this.state.players
        let finalName = base
        if (same.length === 1) {
          players = players.map((p) => p.id === same[0].id ? { ...p, name: `${base} (A)` } : p)
          finalName = `${base} (B)`
        }
        const player = createPlayer(msg.sessionToken, finalName, this.state.startingChips, false)
        this.connPid.set(conn.connectionId, msg.sessionToken)
        this.state = { ...this.state, players: [...players, player] }
        this.send(conn, { type: 'JOIN_OK', sessionToken: msg.sessionToken })
        this.broadcastState(); break
      }
      case 'ACTION':
        if (msg.action.playerId === this.state.currentTurnPlayerId) {
          this.state = applyAction(this.state, msg.action)
          this.broadcastState()
        }
        break
      case 'START_GAME': {
        const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
        this.state = dealNewHand({ ...this.state, players })
        this.broadcastState(); break
      }
      case 'NEXT_HAND':
        this.state = dealNewHand(this.state)
        this.broadcastState(); break
      case 'PING':
        this.send(conn, { type: 'PONG' }); break
    }
  }

  private handleDisconnect(conn: DataConnection) {
    const playerId = this.connPid.get(conn.connectionId)
    this.conns.delete(conn.connectionId)
    this.connPid.delete(conn.connectionId)
    if (!playerId) return

    const wasHost = this.state.players.find((p) => p.id === playerId)?.isHost
    let players = this.state.players.map((p) =>
      p.id === playerId ? { ...p, status: 'disconnected' as const } : p)

    if (wasHost) {
      const next = players.find((p) => p.status === 'connected' && !p.isHost)
      if (next) players = players
        .filter((p) => p.id !== playerId)
        .map((p) => p.id === next.id ? { ...p, isHost: true } : p)
    }

    this.state = { ...this.state, players }
    this.broadcastState()
  }

  private send(conn: DataConnection, msg: ServerMessage) { conn.send(msg) }

  private broadcastState() {
    const msg: ServerMessage = { type: 'STATE', state: this.state }
    this.opts.onState(this.state)
    this.conns.forEach((c) => { if (c.open) c.send(msg) })
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]) {
    this.state = applyAction(this.state, action)
    this.broadcastState()
  }
  startGame() {
    const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
    this.state = dealNewHand({ ...this.state, players })
    this.broadcastState()
  }
  nextHand() { this.state = dealNewHand(this.state); this.broadcastState() }
  leave()    { this.conns.forEach((c) => c.close()); this.peer.destroy() }
}

// ── Guest ─────────────────────────────────────────────────────────────────

export interface PeerGuestOptions {
  payload:    QRPayload & { mode: 'peer' }
  name:       string
  onState:    (s: GameState) => void
  onRejected: (reason: string) => void
}

export class PeerGuestTransport implements Transport {
  readonly role = 'guest' as const
  connected = false
  private peer: Peer
  private conn: DataConnection | null = null

  constructor(private opts: PeerGuestOptions) {
    this.peer = new Peer(STUN)

    this.peer.on('open', () => {
      const conn = this.peer.connect(opts.payload.peerId, { reliable: true })
      this.conn = conn

      conn.on('open', () => {
        this.connected = true
        const name = localStorage.getItem(NAME_KEY) ?? opts.name
        localStorage.setItem(NAME_KEY, name)
        const msg: ClientMessage = { type: 'JOIN', name, sessionToken: sessionToken() }
        conn.send(msg)
      })

      conn.on('data', (d) => {
        const msg = d as ServerMessage
        switch (msg.type) {
          case 'STATE':        opts.onState(msg.state); break
          case 'JOIN_REJECTED': opts.onRejected(msg.reason); break
        }
      })
    })

    this.peer.on('error', (e) => opts.onRejected(String(e)))
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]) { this.send({ type: 'ACTION', action }) }
  startGame() { this.send({ type: 'START_GAME' }) }
  nextHand()  { this.send({ type: 'NEXT_HAND' }) }
  leave()     { this.conn?.close(); this.peer.destroy(); this.connected = false }

  private send(msg: ClientMessage) { if (this.conn?.open) this.conn.send(msg) }
}
