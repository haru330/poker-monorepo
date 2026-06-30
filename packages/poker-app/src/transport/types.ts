import type { Action, GameState } from 'poker-engine'

// ── QR payloads ────────────────────────────────────────────────────────────
export type QRPayload =
  | { mode: 'peer'; peerId: string }
  | { mode: 'rtc';  offer: string; slot: number }
  | { mode: 'supabase'; roomCode: string }

export type QRAnswer =
  | { mode: 'rtc'; answer: string; slot: number }

// ── Transport interface ────────────────────────────────────────────────────
export interface Transport {
  role: 'host' | 'guest'
  connected: boolean
  sendAction(action: Action): void
  startGame(): void
  nextHand(): void
  revealCard(): void
  toggleSpectator(): void
  devPing(playerName: string): void
  abandon(): void
  leave(): void
}

// ── Pairing state (offline only) ──────────────────────────────────────────
export type PairingPhase =
  | { step: 'idle' }
  | { step: 'host-offering';   offer: string; slot: number }
  | { step: 'host-scanning';   slot: number }
  | { step: 'guest-answering'; answer: string; slot: number }
  | { step: 'done' }

// ── Wire messages ──────────────────────────────────────────────────────────
export type ClientMessage =
  | { type: 'JOIN';        name: string; sessionToken: string }
  | { type: 'ACTION';      action: Action }
  | { type: 'START_GAME' }
  | { type: 'NEXT_HAND' }
  | { type: 'REVEAL_CARD' }
  | { type: 'TOGGLE_SPECTATOR' }
  | { type: 'ABANDON' }
  | { type: 'PING' }
  | { type: 'DEV_PING';   playerName: string }

export type ServerMessage =
  | { type: 'ROOM_CREATED';        roomCode: string }
  | { type: 'JOIN_OK';             sessionToken: string }
  | { type: 'JOIN_REJECTED';       reason: string }
  | { type: 'STATE';               state: GameState }
  | { type: 'PONG' }
  | { type: 'DEV_PING_BROADCAST';  playerName: string }
