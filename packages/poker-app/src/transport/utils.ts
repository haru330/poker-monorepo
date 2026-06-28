import type { GameState } from 'poker-engine'

export function createPlayer(id: string, name: string, chips: number, isHost: boolean) {
  return {
    id, name, chips, hand: [] as never[],
    status: 'connected' as const, hasFolded: false,
    isAllIn: false, isHost,
    streetContribution: 0, totalContribution: 0, hasActed: false,
  }
}

export const INITIAL_STATE: GameState = {
  roomCode: '',
  players: [], deck: [], communityCards: [],
  street: 'preflop', pots: [],
  dealerButtonIndex: -1, currentTurnPlayerId: null,
  currentBet: 0, minRaise: 2,
  startingChips: 100,
  currentAnte: 2, startingAnte: 2, handsPerLevel: 5, handNumber: 0,
  actionLog: [], results: null, equity: null, lastAllInCallerId: null, preflopAction: {},
}

/**
 * Strip hole cards from every player except the given peer.
 * Called before each per-peer send so opponents' cards never travel over the wire.
 */
export function filterStateForPlayer(state: GameState, playerId: string): GameState {
  const self = state.players.find((p) => p.id === playerId)
  // Spectators see all hands (god mode)
  if (self?.isSpectator) return state
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? p : { ...p, hand: [] }
    ),
  }
}
