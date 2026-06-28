import type { Card } from './types'
import { rankValue } from './handEvaluator'

export type RangeTier = 'raise' | 'call' | 'check' | 'any'

// ── Hand strength scoring ─────────────────────────────────────────────────────
//
// Pairs: score = rank² + 200  (ensures all pairs outrank most non-pairs)
// Non-pairs: score = hiRank×12 + loRank×3 + (suited ? 20 : 0) − gap_penalty
//   gap_penalty = max(0, gap−1) × 3  (connectors get no penalty, one-gappers −3, etc.)
//
// This ranks ~1326 combos in a GTO-approximate order:
//   top 20% → raise range, 20–45% → call range, 45–70% → check range, rest → any

export function handStrengthScore(c1: Card, c2: Card): number {
  const r1 = rankValue(c1.rank)
  const r2 = rankValue(c2.rank)
  const hi = Math.max(r1, r2)
  const lo = Math.min(r1, r2)
  const suited = c1.suit === c2.suit
  if (hi === lo) return hi * hi + 200
  const gap = hi - lo
  const suitBonus = suited ? 20 : 0
  const gapPenalty = Math.max(0, gap - 1) * 3
  return hi * 12 + lo * 3 + suitBonus - gapPenalty
}

// ── Pre-compute tier score thresholds ─────────────────────────────────────────
//
// Build a full 52-card deck, enumerate all C(52,2)=1326 combos, score + sort,
// then pick the score values at each percentile boundary.

const RANK_STRS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'] as const
const SUIT_STRS = ['spades','hearts','diamonds','clubs'] as const

const STANDARD_DECK: Card[] = []
for (const rank of RANK_STRS) for (const suit of SUIT_STRS) STANDARD_DECK.push({ rank, suit })

const ALL_SCORES: number[] = []
for (let i = 0; i < STANDARD_DECK.length; i++)
  for (let j = i + 1; j < STANDARD_DECK.length; j++)
    ALL_SCORES.push(handStrengthScore(STANDARD_DECK[i], STANDARD_DECK[j]))

ALL_SCORES.sort((a, b) => b - a)  // descending — index 0 = strongest

// Score at each tier boundary (index = how many combos are in the tier)
export const TIER_THRESHOLDS = {
  raise: ALL_SCORES[Math.floor(1326 * 0.20)],  // top 20%
  call:  ALL_SCORES[Math.floor(1326 * 0.45)],  // top 45%
  check: ALL_SCORES[Math.floor(1326 * 0.70)],  // top 70%
} as const

// ── Public API ─────────────────────────────────────────────────────────────────

/** Returns true if this 2-card hand falls within the given preflop range tier. */
export function comboMatchesTier(c1: Card, c2: Card, tier: RangeTier): boolean {
  if (tier === 'any') return true
  const score = handStrengthScore(c1, c2)
  return score >= TIER_THRESHOLDS[tier]
}

/**
 * Pre-filters a card pool to only 2-card combos that match the given tier.
 * Returns an array of [Card, Card] pairs for efficient Monte Carlo sampling.
 */
export function filteredCombos(pool: Card[], tier: RangeTier): [Card, Card][] {
  if (tier === 'any') return []  // caller uses raw pool instead
  const result: [Card, Card][] = []
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++)
      if (comboMatchesTier(pool[i], pool[j], tier))
        result.push([pool[i], pool[j]])
  return result
}
