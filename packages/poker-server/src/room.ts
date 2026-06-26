import type { WebSocket } from 'ws'
import type { GameState, Player } from 'poker-engine'
import { dealNewHand, applyAction } from 'poker-engine'
import type { ClientMessage, ServerMessage } from './messages'
import { generateSessionToken } from './utils'

const MAX_PLAYERS = 8

function createPlayer(id: string, name: string, chips: number, isHost: boolean): Player {
  return {
    id, name, chips,
    hand: [], status: 'connected',
    hasFolded: false, isAllIn: false, isHost,
    streetContribution: 0, totalContribution: 0, hasActed: false,
  }
}

function stripSuffix(name: string): string {
  return name.replace(/ \([AB]\)$/, '')
}

const INITIAL_STATE: Omit<GameState, 'roomCode'> = {
  players: [],
  deck: [],
  communityCards: [],
  street: 'preflop',
  pots: [],
  dealerButtonIndex: -1,
  currentTurnPlayerId: null,
  currentBet: 0,
  minRaise: 0,
  startingChips: 100,
  bigBlind: 2,
  actionLog: [],
  results: null,
}

interface Connection {
  ws: WebSocket
  sessionToken: string
  playerId: string | null
}

export class Room {
  readonly code: string
  private state: GameState
  private connections = new Map<WebSocket, Connection>()

  constructor(code: string) {
    this.code = code
    this.state = { ...INITIAL_STATE, roomCode: code }
  }

  get isEmpty(): boolean {
    return this.connections.size === 0
  }

  add(ws: WebSocket): void {
    const sessionToken = generateSessionToken()
    this.connections.set(ws, { ws, sessionToken, playerId: null })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage
        this.handleMessage(ws, msg)
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => this.handleDisconnect(ws))
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  private broadcast(msg: ServerMessage): void {
    this.connections.forEach(({ ws }) => this.send(ws, msg))
  }

  private broadcastState(): void {
    this.broadcast({ type: 'STATE', state: this.state })
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    const conn = this.connections.get(ws)
    if (!conn) return

    switch (msg.type) {
      case 'PING':
        this.send(ws, { type: 'PONG' })
        break

      case 'JOIN':
        this.handleJoin(ws, conn, msg.name, msg.sessionToken)
        break

      case 'ACTION': {
        if (!conn.playerId) return
        if (msg.action.playerId !== this.state.currentTurnPlayerId) return
        this.state = applyAction(this.state, msg.action)
        this.broadcastState()
        break
      }

      case 'START_GAME': {
        const player = this.state.players.find((p) => p.id === conn.playerId)
        if (!player?.isHost) return
        const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
        this.state = dealNewHand({ ...this.state, players })
        this.broadcastState()
        break
      }

      case 'NEXT_HAND': {
        const player = this.state.players.find((p) => p.id === conn.playerId)
        if (!player?.isHost) return
        this.state = dealNewHand(this.state)
        this.broadcastState()
        break
      }
    }
  }

  private handleJoin(ws: WebSocket, conn: Connection, name: string, sessionToken: string): void {
    // Reconnect: session token already in the player list
    const existing = this.state.players.find((p) => p.id === sessionToken)
    if (existing) {
      conn.playerId = sessionToken
      conn.sessionToken = sessionToken
      this.state = {
        ...this.state,
        players: this.state.players.map((p) =>
          p.id === sessionToken ? { ...p, status: 'connected' } : p,
        ),
      }
      this.send(ws, { type: 'JOIN_OK', sessionToken })
      this.broadcastState()
      return
    }

    // Table full
    if (this.state.players.length >= MAX_PLAYERS) {
      this.send(ws, { type: 'JOIN_REJECTED', reason: 'table is full' })
      return
    }

    // Name conflict
    const baseName = name.trim()
    const sameNamePlayers = this.state.players.filter((p) => baseName === stripSuffix(p.name))
    if (sameNamePlayers.length >= 2) {
      this.send(ws, { type: 'JOIN_REJECTED', reason: 'name taken, try another' })
      return
    }

    const isHost = this.state.players.length === 0
    let players = this.state.players
    let finalName = baseName

    if (sameNamePlayers.length === 1) {
      const existing = sameNamePlayers[0]
      players = players.map((p) => p.id === existing.id ? { ...p, name: `${baseName} (A)` } : p)
      finalName = `${baseName} (B)`
    }

    const player = createPlayer(sessionToken, finalName, this.state.startingChips, isHost)
    conn.playerId = sessionToken
    conn.sessionToken = sessionToken
    this.state = { ...this.state, players: [...players, player] }

    this.send(ws, { type: 'JOIN_OK', sessionToken })
    this.broadcastState()
  }

  private handleDisconnect(ws: WebSocket): void {
    const conn = this.connections.get(ws)
    this.connections.delete(ws)

    if (!conn?.playerId) return

    this.state = {
      ...this.state,
      players: this.state.players.map((p) =>
        p.id === conn.playerId ? { ...p, status: 'disconnected' } : p,
      ),
    }

    // If the host disconnected, promote the first connected player
    const disconnectedPlayer = this.state.players.find((p) => p.id === conn.playerId)
    if (disconnectedPlayer?.isHost) {
      const nextHost = this.state.players.find((p) => p.status === 'connected' && !p.isHost)
      if (nextHost) {
        this.state = {
          ...this.state,
          players: this.state.players
            .filter((p) => p.id !== conn.playerId)
            .map((p) => p.id === nextHost.id ? { ...p, isHost: true } : p),
        }
      }
    }

    this.broadcastState()
  }
}
