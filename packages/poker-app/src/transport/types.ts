import type { Action, GameState } from 'poker-engine'

// ── QR payloads ────────────────────────────────────────────────────────────
// Both modes encode JSON into the QR. The `mode` field lets the scanner
// know which transport path to take without any extra UI decision.

export type QRPayload =
  | { mode: 'peer'; peerId: string }                 // online: PeerJS peer ID
  | { mode: 'rtc';  offer: string; slot: number }    // offline: WebRTC SDP offer

export type QRAnswer =
  | { mode: 'rtc'; answer: string; slot: number }    // offline: WebRTC SDP answer

// ── Transport interface ────────────────────────────────────────────────────
// The UI only ever talks to this interface — never to WS or RTC directly.

export interface Transport {
  role: 'host' | 'guest'
  connected: boolean
  sendAction(action: Action): void
  startGame(): void
  nextHand(): void
  leave(): void
}

// ── Pairing state (offline only) ──────────────────────────────────────────
// Drives the sequential QR ceremony on both host and guest screens.

export type PairingPhase =
  | { step: 'idle' }
  | { step: 'host-offering';  offer: string; slot: number }  // host shows offer QR
  | { step: 'host-scanning';  slot: number }                 // host scans guest answer
  | { step: 'guest-answering'; answer: string; slot: number } // guest shows answer QR
  | { step: 'done' }

// ── Wire messages (shared by WS + RTC data channel) ───────────────────────

export type ClientMessage =
  | { type: 'JOIN';       name: string; sessionToken: string }
  | { type: 'ACTION';     action: Action }
  | { type: 'START_GAME' }
  | { type: 'NEXT_HAND' }
  | { type: 'PING' }

export type ServerMessage =
  | { type: 'ROOM_CREATED'; roomCode: string }
  | { type: 'JOIN_OK';      sessionToken: string }
  | { type: 'JOIN_REJECTED'; reason: string }
  | { type: 'STATE';        state: GameState }
  | { type: 'PONG' }
