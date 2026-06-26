import type { Action, GameState } from 'poker-engine'

// Client → Server
export type ClientMessage =
  | { type: 'JOIN';        name: string; sessionToken: string }
  | { type: 'ACTION';      action: Action }
  | { type: 'START_GAME' }
  | { type: 'NEXT_HAND' }
  | { type: 'PING' }

// Server → Client
export type ServerMessage =
  | { type: 'ROOM_CREATED'; roomCode: string }
  | { type: 'JOIN_OK';      sessionToken: string }
  | { type: 'JOIN_REJECTED'; reason: string }
  | { type: 'STATE';        state: GameState }
  | { type: 'PONG' }
