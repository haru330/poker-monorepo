export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type ActionType = 'raise' | 'call' | 'check' | 'fold';

export interface Action {
  playerId: string;
  type: ActionType;
  /** For 'raise': the new total street contribution ("raise to $X"), not the increment. */
  amount?: number;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type ConnectionStatus = 'connected' | 'disconnected';

export interface Player {
  id: string;
  name: string;
  chips: number;
  hand: Card[];
  status: ConnectionStatus;
  hasFolded: boolean;
  isAllIn: boolean;
  isHost: boolean;
  /** Chips put in during the current street (reset each street). */
  streetContribution: number;
  /** Chips put in during the current hand (reset each hand, used for side pots). */
  totalContribution: number;
  /** Whether this player has acted during the current street's betting round. */
  hasActed: boolean;
}

export interface Pot {
  id: string;
  amount: number;
  eligiblePlayerIds: string[];
}

export interface ActionLogEntry {
  id: string;
  message: string;
}

export interface PotWinner {
  playerId: string;
  amount: number;
  handDescription: string;
}

export interface ShowdownResult {
  potId: string;
  winners: PotWinner[];
  /** How the winner beat the closest non-winning hand (null if no contest or true split). */
  tiebreakNote: string | null;
}

export interface GameState {
  roomCode: string;
  players: Player[];
  deck: Card[];
  communityCards: Card[];
  street: Street;
  pots: Pot[];
  dealerButtonIndex: number;
  currentTurnPlayerId: string | null;
  /** The amount each player must match to stay in this street. */
  currentBet: number;
  /** Minimum size of the next raise. */
  minRaise: number;
  startingChips: number;
  /** Ante amount for the current hand (derived from handNumber + handsPerLevel). */
  currentAnte: number;
  /** Starting ante amount (level 1). Doubles each level. */
  startingAnte: number;
  /** How many hands before the ante doubles. */
  handsPerLevel: number;
  /** Total hands dealt so far (increments each dealNewHand). */
  handNumber: number;
  actionLog: ActionLogEntry[];
  results: ShowdownResult[] | null;
}
