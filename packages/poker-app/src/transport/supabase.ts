import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import type { GameState } from 'poker-engine'
import { dealNewHand, applyAction } from 'poker-engine'
import type { QRPayload, Transport } from './types'
import { createPlayer, INITIAL_STATE, filterStateForPlayer } from './utils'
import { devLog } from '../devLog'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)

type ActionPayload =
  | { type: 'JOIN'; name: string }
  | { type: 'ACTION'; action: Parameters<Transport['sendAction']>[0] }
  | { type: 'NEXT_HAND' }
  | { type: 'REVEAL_CARD' }
  | { type: 'TOGGLE_SPECTATOR' }
  | { type: 'DEV_PING'; playerName: string }

function generateRoomCode(): string {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * 26)]).join('')
}

// ── Host ──────────────────────────────────────────────────────────────────

export interface SupabaseHostOptions {
  hostName: string
  onState:  (s: GameState) => void
  onQR:     (payload: QRPayload) => void
  onError:  (reason: string) => void
  onDevPing: (playerName: string) => void
}

export class SupabaseHostTransport implements Transport {
  readonly role = 'host' as const
  connected = true

  private state: GameState
  private hostPlayerId: string
  private roomCode: string
  private allInRevealCount = 0
  private channel: RealtimeChannel | null = null

  constructor(private opts: SupabaseHostOptions) {
    const token = localStorage.getItem('poker-session-token') ?? crypto.randomUUID()
    localStorage.setItem('poker-session-token', token)
    localStorage.setItem('poker-username', opts.hostName)
    this.hostPlayerId = token
    this.roomCode = generateRoomCode()

    const player = createPlayer(token, opts.hostName, INITIAL_STATE.startingChips, true)
    this.state = { ...INITIAL_STATE, roomCode: this.roomCode, players: [player] }

    this.init()
  }

  private async init() {
    devLog('info', `[SupabaseHost] creating room ${this.roomCode}`)

    const { error } = await supabase.from('rooms').insert({
      room_code: this.roomCode,
      state: this.stateWithReveal(),
      host_id: this.hostPlayerId,
    })

    if (error) {
      devLog('error', `[SupabaseHost] failed to create room: ${error.message}`)
      this.opts.onError(`Failed to create room: ${error.message}`)
      return
    }

    devLog('info', `[SupabaseHost] room created, subscribing`)
    this.opts.onState(filterStateForPlayer(this.stateWithReveal(), this.hostPlayerId))
    this.opts.onQR({ mode: 'supabase', roomCode: this.roomCode })

    this.channel = supabase
      .channel(`room-${this.roomCode}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'room_actions',
        filter: `room_code=eq.${this.roomCode}`,
      }, (payload) => {
        const row = payload.new as { id: number; player_id: string; payload: ActionPayload }
        devLog('debug', `[SupabaseHost] action from ${row.player_id}: ${row.payload.type}`)
        this.handleGuestAction(row)
      })
      .on('broadcast', { event: 'dev_ping' }, ({ payload }) => {
        devLog('info', `[SupabaseHost] broadcast dev_ping from ${payload.playerName}`)
        this.opts.onDevPing(payload.playerName)
      })
      .subscribe((status) => devLog('debug', `[SupabaseHost] channel: ${status}`))
  }

  private handleGuestAction(row: { id: number; player_id: string; payload: ActionPayload }) {
    const p = row.payload

    switch (p.type) {
      case 'JOIN': {
        if (this.state.handNumber !== 0) break
        const existing = this.state.players.find((pl) => pl.id === row.player_id)
        if (existing) {
          // Reconnect
          this.state = { ...this.state, players: this.state.players.map((pl) => pl.id === row.player_id ? { ...pl, status: 'connected' } : pl) }
          this.writeState()
        } else if (this.state.players.length < 8) {
          const player = createPlayer(row.player_id, p.name, this.state.startingChips, false)
          this.state = { ...this.state, players: [...this.state.players, player] }
          devLog('info', `[SupabaseHost] player joined: ${p.name} (${this.state.players.length} total)`)
          this.writeState()
        }
        break
      }
      case 'ACTION':
        if (p.action.playerId === this.state.currentTurnPlayerId) {
          setTimeout(() => {
            const prevCount = this.state.communityCards.length
            const prevStreet = this.state.street
            this.state = applyAction(this.state, p.action)
            if (this.state.street === 'showdown' && prevStreet !== 'showdown' && this.state.lastAllInCallerId) {
              this.allInRevealCount = prevCount
            }
            this.writeState()
          }, 0)
        }
        break
      case 'NEXT_HAND':
        this.allInRevealCount = 0
        setTimeout(() => { this.state = dealNewHand(this.state); this.writeState() }, 0)
        break
      case 'REVEAL_CARD':
        if (this.state.street === 'showdown' && this.allInRevealCount < 5) {
          this.allInRevealCount++
          this.writeState()
        }
        break
      case 'TOGGLE_SPECTATOR':
        if (this.state.handNumber === 0) {
          this.state = { ...this.state, players: this.state.players.map((pl) => pl.id === row.player_id ? { ...pl, isSpectator: !pl.isSpectator } : pl) }
          this.writeState()
        }
        break
      case 'DEV_PING':
        this.opts.onDevPing(p.playerName)
        this.channel?.send({ type: 'broadcast', event: 'dev_ping', payload: { playerName: p.playerName } })
        break
    }

    // Clean up processed action
    supabase.from('room_actions').delete().eq('id', row.id).then(() => {})
  }

  private stateWithReveal(): GameState {
    return this.state.lastAllInCallerId && this.state.street === 'showdown'
      ? { ...this.state, allInRevealCount: this.allInRevealCount }
      : this.state
  }

  private async writeState() {
    const s = this.stateWithReveal()
    this.opts.onState(filterStateForPlayer(s, this.hostPlayerId))
    const { error } = await supabase.from('rooms')
      .update({ state: s, updated_at: new Date().toISOString() })
      .eq('room_code', this.roomCode)
    if (error) devLog('error', `[SupabaseHost] write failed: ${error.message}`)
    else devLog('debug', `[SupabaseHost] state written, turn=${s.currentTurnPlayerId}`)
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]) {
    devLog('info', `[SupabaseHost] sendAction ${action.type}`)
    const prevCount = this.state.communityCards.length
    const prevStreet = this.state.street
    setTimeout(() => {
      this.state = applyAction(this.state, action)
      if (this.state.street === 'showdown' && prevStreet !== 'showdown' && this.state.lastAllInCallerId) {
        this.allInRevealCount = prevCount
      }
      this.writeState()
    }, 0)
  }

  startGame() {
    devLog('info', `[SupabaseHost] startGame`)
    this.allInRevealCount = 0
    setTimeout(() => {
      const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
      this.state = dealNewHand({ ...this.state, players })
      this.writeState()
    }, 0)
  }

  nextHand() {
    devLog('info', `[SupabaseHost] nextHand`)
    this.allInRevealCount = 0
    setTimeout(() => { this.state = dealNewHand(this.state); this.writeState() }, 0)
  }

  revealCard() {
    if (this.state.street === 'showdown' && this.allInRevealCount < 5) {
      this.allInRevealCount++
      this.writeState()
    }
  }

  toggleSpectator() {
    if (this.state.handNumber !== 0) return
    this.state = { ...this.state, players: this.state.players.map((p) => p.id === this.hostPlayerId ? { ...p, isSpectator: !p.isSpectator } : p) }
    this.writeState()
  }

  devPing(playerName: string) {
    devLog('info', `[SupabaseHost] devPing: ${playerName}`)
    this.opts.onDevPing(playerName)
    this.channel?.send({ type: 'broadcast', event: 'dev_ping', payload: { playerName } })
  }

  leave() {
    devLog('info', `[SupabaseHost] leave, deleting room ${this.roomCode}`)
    this.channel?.unsubscribe()
    supabase.from('rooms').delete().eq('room_code', this.roomCode).then(() => {})
    this.connected = false
  }
}

// ── Guest ─────────────────────────────────────────────────────────────────

export interface SupabaseGuestOptions {
  roomCode: string
  name: string
  onState:    (s: GameState) => void
  onRejected: (reason: string) => void
  onDevPing:  (playerName: string) => void
}

export class SupabaseGuestTransport implements Transport {
  readonly role = 'guest' as const
  connected = false

  private playerId: string
  private roomCode: string
  private channel: RealtimeChannel | null = null

  constructor(private opts: SupabaseGuestOptions) {
    const token = localStorage.getItem('poker-session-token') ?? crypto.randomUUID()
    localStorage.setItem('poker-session-token', token)
    const name = localStorage.getItem('poker-username') ?? opts.name
    localStorage.setItem('poker-username', name)
    this.playerId = token
    this.roomCode = opts.roomCode.toUpperCase()
    devLog('info', `[SupabaseGuest] joining room ${this.roomCode}`)
    this.init(name)
  }

  private async init(name: string) {
    // Check room exists
    const { data: room, error } = await supabase
      .from('rooms').select('state').eq('room_code', this.roomCode).single()

    if (error || !room) {
      devLog('warn', `[SupabaseGuest] room not found: ${this.roomCode}`)
      this.opts.onRejected('Room not found — check the room code')
      return
    }

    const state = room.state as GameState
    if (state.handNumber > 0) {
      this.opts.onRejected('Game already in progress')
      return
    }
    if (state.players.length >= 8) {
      this.opts.onRejected('Table is full')
      return
    }

    // Subscribe to state changes and broadcasts
    this.channel = supabase
      .channel(`room-${this.roomCode}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `room_code=eq.${this.roomCode}`,
      }, (payload) => {
        const s = payload.new.state as GameState
        devLog('debug', `[SupabaseGuest] state update, turn=${s.currentTurnPlayerId}`)
        this.opts.onState(filterStateForPlayer(s, this.playerId))
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'rooms',
        filter: `room_code=eq.${this.roomCode}`,
      }, () => {
        devLog('warn', `[SupabaseGuest] room deleted (host left)`)
        this.opts.onRejected('Host left the game')
      })
      .on('broadcast', { event: 'dev_ping' }, ({ payload }) => {
        devLog('info', `[SupabaseGuest] broadcast dev_ping from ${payload.playerName}`)
        this.opts.onDevPing(payload.playerName)
      })
      .subscribe(async (status) => {
        devLog('debug', `[SupabaseGuest] channel: ${status}`)
        if (status === 'SUBSCRIBED') {
          // Send JOIN once subscribed so we don't miss the state update response
          await this.sendToHost({ type: 'JOIN', name })
          this.connected = true
          devLog('info', `[SupabaseGuest] JOIN sent`)
        }
      })
  }

  private async sendToHost(payload: ActionPayload) {
    const { error } = await supabase.from('room_actions').insert({
      room_code: this.roomCode,
      player_id: this.playerId,
      payload,
    })
    if (error) devLog('error', `[SupabaseGuest] send failed: ${error.message}`)
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]) { this.sendToHost({ type: 'ACTION', action }) }
  nextHand()         { this.sendToHost({ type: 'NEXT_HAND' }) }
  revealCard()       { this.sendToHost({ type: 'REVEAL_CARD' }) }
  toggleSpectator()  { this.sendToHost({ type: 'TOGGLE_SPECTATOR' }) }
  startGame()        { /* host only */ }
  devPing(playerName: string) {
    devLog('info', `[SupabaseGuest] devPing: ${playerName}`)
    this.sendToHost({ type: 'DEV_PING', playerName })
  }

  leave() {
    devLog('info', `[SupabaseGuest] leave`)
    this.channel?.unsubscribe()
    this.connected = false
  }
}
