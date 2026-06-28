import type { Card, GameState, Player } from './types'
import { evaluateHand } from './handEvaluator'
import { compareHands } from './handEvaluator'
import type { RangeTier } from './ranges'
import { filteredCombos } from './ranges'

export interface EquityResult {
  playerId: string
  win: number  // 0.0–1.0
  tie: number  // 0.0–1.0 (split-pot share)
}

export interface EquityByStreet {
  preflop?: EquityResult[]  // hand vs random, no community cards
  flop: EquityResult[]
  turn: EquityResult[]
  river: EquityResult[]
}

export interface HandEquity {
  spectator: EquityByStreet  // exact equity, all hole cards visible
  range: EquityByStreet      // each player vs random opponent hand distribution
  lastAllInCallerId: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const cardKey = (c: Card) => `${c.rank}|${c.suit}`

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function winnerIds(players: Player[], community: Card[]): string[] {
  if (players.length === 0) return []
  const scored = players.map(p => ({ id: p.id, ev: evaluateHand([...p.hand, ...community]) }))
  let best = scored[0].ev
  for (const s of scored) if (compareHands(s.ev, best) > 0) best = s.ev
  return scored.filter(s => compareHands(s.ev, best) === 0).map(s => s.id)
}

function tally(
  ids: string[],
  wins: Map<string, number>,
  ties: Map<string, number>,
) {
  if (ids.length === 1) {
    wins.set(ids[0], (wins.get(ids[0]) ?? 0) + 1)
  } else {
    // Each tied player gets a 1/N fractional share so that sum of all ties = 1 scenario
    const share = 1 / ids.length
    for (const id of ids) ties.set(id, (ties.get(id) ?? 0) + share)
  }
}

function toResults(
  players: Player[],
  wins: Map<string, number>,
  ties: Map<string, number>,
  total: number,
): EquityResult[] {
  return players.map(p => ({
    playerId: p.id,
    win: total > 0 ? (wins.get(p.id) ?? 0) / total : 0,
    tie: total > 0 ? (ties.get(p.id) ?? 0) / total : 0,
  }))
}

// ── Spectator equity: exact enumeration ──────────────────────────────────────

function exactEquity(
  players: Player[],
  knownCommunity: Card[],
  pool: Card[],
  needed: number,
): EquityResult[] {
  const wins = new Map<string, number>()
  const ties = new Map<string, number>()
  players.forEach(p => { wins.set(p.id, 0); ties.set(p.id, 0) })
  let total = 0

  if (needed === 0) {
    tally(winnerIds(players, knownCommunity), wins, ties)
    total = 1
  } else if (needed === 1) {
    for (const card of pool) {
      tally(winnerIds(players, [...knownCommunity, card]), wins, ties)
      total++
    }
  } else {
    // needed === 2 (flop stage)
    const n = pool.length
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        tally(winnerIds(players, [...knownCommunity, pool[i], pool[j]]), wins, ties)
        total++
      }
    }
  }

  return toResults(players, wins, ties, total)
}

// ── Range equity: Monte Carlo, player doesn't know opponents' hole cards ──────

function rangeEquityForPlayer(
  hero: Player,
  allActive: Player[],
  knownCommunity: Card[],
  deck52: Card[],
  samples: number,
  // Optional: per-opponent preflop range tiers inferred from betting actions
  opponentTiers: Record<string, RangeTier> = {},
): EquityResult {
  const knownSet = new Set([...hero.hand, ...knownCommunity].map(cardKey))
  const pool = deck52.filter(c => !knownSet.has(cardKey(c)))

  const opponents = allActive.filter(p => p.id !== hero.id)
  const opCount = opponents.length
  const boardNeeded = 5 - knownCommunity.length
  const needed = opCount * 2 + boardNeeded

  if (pool.length < needed) return { playerId: hero.id, win: 0, tie: 0 }

  // Pre-compute filtered combo lists for each opponent with a known tier.
  // filteredCombos is O(pool²) but called once per player, not per sample.
  const oppRangeCombos: ([Card, Card][] | null)[] = opponents.map(opp => {
    const tier = opponentTiers[opp.id] ?? 'any'
    return tier === 'any' ? null : filteredCombos(pool, tier)
  })

  let wins = 0, ties = 0

  for (let s = 0; s < samples; s++) {
    const usedKeys = new Set<string>()
    const simOpponents: Player[] = []

    for (let oi = 0; oi < opponents.length; oi++) {
      const opp = opponents[oi]
      const combos = oppRangeCombos[oi]

      let hand: Card[]
      if (!combos) {
        // No range filter: sample randomly from unused pool cards
        const avail = pool.filter(c => !usedKeys.has(cardKey(c)))
        const shuffled = fisherYates(avail)
        hand = [shuffled[0], shuffled[1]]
      } else {
        // Range-filtered: pick a random combo where both cards are unused
        const avail = combos.filter(([a, b]) => !usedKeys.has(cardKey(a)) && !usedKeys.has(cardKey(b)))
        if (avail.length === 0) {
          // Fallback: no valid range combo available (very rare) — use random
          const shuffled = fisherYates(pool.filter(c => !usedKeys.has(cardKey(c))))
          hand = [shuffled[0], shuffled[1]]
        } else {
          const [a, b] = avail[Math.floor(Math.random() * avail.length)]
          hand = [a, b]
        }
      }
      hand.forEach(c => usedKeys.add(cardKey(c)))
      simOpponents.push({ ...opp, hand: hand as Card[] })
    }

    // Board runout from remaining unused pool cards
    const boardPool = pool.filter(c => !usedKeys.has(cardKey(c)))
    const shuffledBoard = fisherYates(boardPool)
    const board: Card[] = [...knownCommunity, ...shuffledBoard.slice(0, boardNeeded)]

    const ids = winnerIds([hero, ...simOpponents], board)
    if (ids.includes(hero.id)) {
      if (ids.length === 1) wins++; else ties++
    }
  }

  return { playerId: hero.id, win: wins / samples, tie: ties / samples }
}

// ── Main pre-computation ──────────────────────────────────────────────────────

const RANGE_SAMPLES = 500

/**
 * Called after preflop ends (on transition to flop).
 * Re-runs only the range equity portion of the existing HandEquity,
 * this time using each opponent's preflop betting action to filter their range:
 *   raise → top 20% of hands, call → top 45%, check → top 70%, no entry → any
 *
 * Spectator equity is unchanged (it only depends on actual hole cards).
 */
export function recomputeRangeEquity(state: GameState): HandEquity | null {
  if (!state.equity) return null

  const active = state.players.filter(p => !p.hasFolded && p.hand.length === 2)
  if (active.length < 2 || state.deck.length < 5) return state.equity

  const dealt = state.players.flatMap(p => p.hand)
  const deck52 = [...state.deck, ...dealt]

  // Reconstruct community cards at all stages.
  // state.communityCards has already-revealed cards; peek remaining from end of deck.
  const d = state.deck
  const n = d.length
  const revealed = state.communityCards  // 0, 3, 4, or 5 cards already on board

  let flop: Card[], turn: Card, river: Card
  if (revealed.length >= 5) {
    flop = revealed.slice(0, 3); turn = revealed[3]; river = revealed[4]
  } else if (revealed.length === 4) {
    flop = revealed.slice(0, 3); turn = revealed[3]; river = d[n - 1]
  } else if (revealed.length === 3) {
    flop = [...revealed]; turn = d[n - 1]; river = d[n - 2]
  } else {
    // preflop: all 5 board cards still in deck
    flop = [d[n - 1], d[n - 2], d[n - 3]]; turn = d[n - 4]; river = d[n - 5]
  }

  // Build opponent tier map from preflop actions
  const opponentTiers: Record<string, RangeTier> = {}
  for (const [id, action] of Object.entries(state.preflopAction)) {
    opponentTiers[id] = action
  }

  const rangeAt = (community: Card[]) =>
    active.map(p => rangeEquityForPlayer(p, active, community, deck52, RANGE_SAMPLES, opponentTiers))

  return {
    ...state.equity,
    range: {
      flop:  rangeAt(flop),
      turn:  rangeAt([...flop, turn]),
      river: rangeAt([...flop, turn, river]),
    },
  }
}

export function precomputeEquity(state: GameState): HandEquity {
  const active = state.players.filter(p => !p.hasFolded && p.hand.length === 2)
  const zero: EquityResult[] = active.map(p => ({ playerId: p.id, win: 0, tie: 0 }))
  const empty: HandEquity = {
    spectator: { flop: zero, turn: zero, river: zero },
    range:     { flop: zero, turn: zero, river: zero },
    lastAllInCallerId: null,
  }

  if (active.length < 2 || state.deck.length < 5) return empty

  // Reconstruct full 52-card deck for range equity pool
  const dealt = state.players.flatMap(p => p.hand)
  const deck52 = [...state.deck, ...dealt]

  // Peek at actual community cards at end of remaining deck
  const d = state.deck
  const n = d.length
  const flop  = [d[n - 1], d[n - 2], d[n - 3]]
  const turn  =  d[n - 4]
  const river =  d[n - 5]

  // Pool for enumeration at each stage (remaining after flop/turn cards popped)
  const poolAfterFlop = d.slice(0, n - 3)   // 39 cards (includes actual turn + river)
  const poolAfterTurn = d.slice(0, n - 4)   // 38 cards (includes actual river)

  // ── Spectator: exact enumeration ─────────────────────────────────────────
  const specFlop  = exactEquity(active, flop, poolAfterFlop, 2)
  const specTurn  = exactEquity(active, [...flop, turn], poolAfterTurn, 1)
  const specRiver = exactEquity(active, [...flop, turn, river], [], 0)

  // ── Range: Monte Carlo per player ─────────────────────────────────────────
  const rangeAt = (community: Card[], samples: number) =>
    active.map(p => rangeEquityForPlayer(p, active, community, deck52, samples))

  const rangePreflop = rangeAt([], RANGE_SAMPLES)
  const rangeFlop  = rangeAt(flop, RANGE_SAMPLES)
  const rangeTurn  = rangeAt([...flop, turn], RANGE_SAMPLES)
  const rangeRiver = rangeAt([...flop, turn, river], RANGE_SAMPLES)

  return {
    spectator: { flop: specFlop, turn: specTurn, river: specRiver },
    range:     { preflop: rangePreflop, flop: rangeFlop, turn: rangeTurn, river: rangeRiver },
    lastAllInCallerId: null,
  }
}
