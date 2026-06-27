import Peer, { type DataConnection } from 'peerjs'
import type { GameState } from 'poker-engine'
import { dealNewHand, applyAction } from 'poker-engine'
import type { ClientMessage, QRPayload, ServerMessage, Transport } from './types'
import { devLog } from '../devLog'

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
  onDevPing: (playerName: string) => void
}

export class PeerHostTransport implements Transport {
  readonly role = 'host' as const
  connected = true

  private peer: Peer
  private conns   = new Map<string, DataConnection>()
  private connPid = new Map<string, string>()
  private state: GameState

  constructor(private opts: PeerHostOptions) {
    const roomCode = generateRoomCode()
    this.state = { ...INITIAL_STATE, roomCode }
    devLog('info', `[PeerHost] creating peer with roomCode=${roomCode}`)
    this.peer  = new Peer(roomCode, STUN)

    this.peer.on('open', (id) => {
      devLog('info', `[PeerHost] peer open, id=${id}`)
      const token = sessionToken()
      localStorage.setItem('poker-username', opts.hostName)
      const player = createPlayer(token, opts.hostName, this.state.startingChips, true)
      this.state = { ...this.state, players: [player] }
      opts.onState(this.state)
      opts.onQR({ mode: 'peer', peerId: id })
    })
    this.peer.on('connection', (conn) => {
      devLog('info', `[PeerHost] incoming connection connId=${conn.connectionId}`)
      this.onConnection(conn)
    })
    this.peer.on('error', (e) => {
      devLog('error', `[PeerHost] peer error: ${e}`)
      opts.onError(String(e))
    })
  }

  private onConnection(conn: DataConnection) {
    this.conns.set(conn.connectionId, conn)
    conn.on('data',  (d) => this.handleMessage(conn, d as ClientMessage))
    conn.on('close', ()  => this.handleDisconnect(conn))
    conn.on('error', (e) => devLog('error', `[PeerHost] conn error connId=${conn.connectionId}: ${e}`))
  }

  private handleMessage(conn: DataConnection, msg: ClientMessage) {
    devLog('debug', `[PeerHost] rx from connId=${conn.connectionId}: ${msg.type}`)
    switch (msg.type) {
      case 'JOIN': {
        const existing = this.state.players.find((p) => p.id === msg.sessionToken)
        if (existing) {
          devLog('info', `[PeerHost] reconnect: ${existing.name}`)
          this.connPid.set(conn.connectionId, msg.sessionToken)
          this.state = {
            ...this.state,
            players: this.state.players.map((p) =>
              p.id === msg.sessionToken ? { ...p, status: 'connected' } : p,
            ),
          }
          this.send(conn, { type: 'JOIN_OK', sessionToken: msg.sessionToken })
          this.broadcastState(); return
        }
        if (this.state.players.length >= 8) {
          devLog('warn', `[PeerHost] JOIN rejected: table full`)
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
        devLog('info', `[PeerHost] player joined: ${finalName} (${this.state.players.length} total)`)
        this.send(conn, { type: 'JOIN_OK', sessionToken: msg.sessionToken })
        this.broadcastState(); break
      }
      case 'ACTION':
        if (msg.action.playerId === this.state.currentTurnPlayerId) {
          devLog('info', `[PeerHost] action ${msg.action.type} from ${msg.action.playerId}`)
          this.state = applyAction(this.state, msg.action)
          this.broadcastState()
        }
        break
      case 'START_GAME': {
        devLog('info', `[PeerHost] START_GAME from guest`)
        const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
        this.state = dealNewHand({ ...this.state, players })
        devLog('info', `[PeerHost] game started, currentTurn=${this.state.currentTurnPlayerId}`)
        this.broadcastState(); break
      }
      case 'NEXT_HAND':
        this.state = dealNewHand(this.state)
        devLog('info', `[PeerHost] next hand dealt`)
        this.broadcastState(); break
      case 'PING':
        this.send(conn, { type: 'PONG' }); break
      case 'DEV_PING': {
        devLog('info', `[PeerHost] DEV_PING from ${msg.playerName}`)
        this.opts.onDevPing(msg.playerName)
        const broadcast: ServerMessage = { type: 'DEV_PING_BROADCAST', playerName: msg.playerName }
        this.conns.forEach((c) => { if (c.open) c.send(broadcast) })
        break
      }
    }
  }

  private handleDisconnect(conn: DataConnection) {
    const playerId = this.connPid.get(conn.connectionId)
    devLog('info', `[PeerHost] conn closed connId=${conn.connectionId} playerId=${playerId ?? 'unknown'}`)
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
    devLog('debug', `[PeerHost] broadcasting STATE to ${this.conns.size} connections, players=${this.state.players.length}, turn=${this.state.currentTurnPlayerId}`)
    this.opts.onState(this.state)
    this.conns.forEach((c) => { if (c.open) c.send(msg) })
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]) {
    devLog('info', `[PeerHost] host sendAction ${action.type}`)
    this.state = applyAction(this.state, action)
    this.broadcastState()
  }
  startGame() {
    devLog('info', `[PeerHost] host startGame, players=${this.state.players.length}`)
    const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
    this.state = dealNewHand({ ...this.state, players })
    devLog('info', `[PeerHost] game started, currentTurn=${this.state.currentTurnPlayerId}`)
    this.broadcastState()
  }
  nextHand() {
    devLog('info', `[PeerHost] nextHand`)
    this.state = dealNewHand(this.state); this.broadcastState()
  }
  devPing(playerName: string) {
    devLog('info', `[PeerHost] host devPing: ${playerName}`)
    this.opts.onDevPing(playerName)
    const broadcast: ServerMessage = { type: 'DEV_PING_BROADCAST', playerName }
    this.conns.forEach((c) => { if (c.open) c.send(broadcast) })
  }
  leave() { this.conns.forEach((c) => c.close()); this.peer.destroy() }
}

// ── Guest ─────────────────────────────────────────────────────────────────

export interface PeerGuestOptions {
  payload:    QRPayload & { mode: 'peer' }
  name:       string
  onState:    (s: GameState) => void
  onRejected: (reason: string) => void
  onDevPing:  (playerName: string) => void
}

export class PeerGuestTransport implements Transport {
  readonly role = 'guest' as const
  connected = false
  private peer: Peer
  private conn: DataConnection | null = null

  constructor(private opts: PeerGuestOptions) {
    devLog('info', `[PeerGuest] connecting to peerId=${opts.payload.peerId}`)
    this.peer = new Peer(STUN)

    this.peer.on('open', () => {
      devLog('info', `[PeerGuest] local peer open, connecting to host`)
      const conn = this.peer.connect(opts.payload.peerId, { reliable: true })
      this.conn = conn

      conn.on('open', () => {
        this.connected = true
        devLog('info', `[PeerGuest] connection open, sending JOIN`)
        const name = localStorage.getItem(NAME_KEY) ?? opts.name
        localStorage.setItem(NAME_KEY, name)
        const msg: ClientMessage = { type: 'JOIN', name, sessionToken: sessionToken() }
        conn.send(msg)
      })

      conn.on('data', (d) => {
        const msg = d as ServerMessage
        devLog('debug', `[PeerGuest] rx: ${msg.type}`)
        switch (msg.type) {
          case 'STATE':
            devLog('debug', `[PeerGuest] STATE received, turn=${msg.state.currentTurnPlayerId}, players=${msg.state.players.length}`)
            opts.onState(msg.state); break
          case 'JOIN_REJECTED':
            devLog('warn', `[PeerGuest] JOIN_REJECTED: ${msg.reason}`)
            opts.onRejected(msg.reason); break
          case 'JOIN_OK':
            devLog('info', `[PeerGuest] JOIN_OK`); break
          case 'DEV_PING_BROADCAST':
            devLog('info', `[PeerGuest] DEV_PING_BROADCAST from ${msg.playerName}`)
            opts.onDevPing(msg.playerName); break
        }
      })

      conn.on('close', () => { devLog('warn', `[PeerGuest] connection closed (host left)`); opts.onRejected('Host left the game') })
      conn.on('error', (e) => { devLog('error', `[PeerGuest] conn error: ${e}`); opts.onRejected('Host left the game') })
    })

    this.peer.on('error', (e) => {
      devLog('error', `[PeerGuest] peer error: ${e}`)
      opts.onRejected(String(e))
    })
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]) { this.send({ type: 'ACTION', action }) }
  startGame() { this.send({ type: 'START_GAME' }) }
  nextHand()  { this.send({ type: 'NEXT_HAND' }) }
  devPing(playerName: string) {
    devLog('info', `[PeerGuest] sending DEV_PING: ${playerName}`)
    this.send({ type: 'DEV_PING', playerName })
  }
  leave() { this.conn?.close(); this.peer.destroy(); this.connected = false }

  private send(msg: ClientMessage) {
    if (this.conn?.open) this.conn.send(msg)
    else devLog('warn', `[PeerGuest] tried to send ${msg.type} but conn not open`)
  }
}
