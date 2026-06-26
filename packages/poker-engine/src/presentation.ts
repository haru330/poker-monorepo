import type { Card } from './types'
import type { HandEvaluation } from './handEvaluator'
import { rankValue } from './handEvaluator'

const RANK_NAMES: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
}

function rankName(value: number): string {
  return RANK_NAMES[value] ?? String(value)
}

/** e.g. "Full House (3Q + 2K)", "Two Pair (J + 8)", "Straight (10 high)" */
export function describeHand(evaluation: HandEvaluation): string {
  const { category, ranks } = evaluation
  switch (category) {
    case 'High Card':         return `High Card (${rankName(ranks[0])})`
    case 'Pair':              return `Pair (${rankName(ranks[0])})`
    case 'Two Pair':          return `Two Pair (${rankName(ranks[0])} + ${rankName(ranks[1])})`
    case 'Three of a Kind':   return `Three of a Kind (${rankName(ranks[0])})`
    case 'Straight':          return `Straight (${rankName(ranks[0])} high)`
    case 'Flush':             return `Flush (${rankName(ranks[0])} high)`
    case 'Full House':        return `Full House (3${rankName(ranks[0])} + 2${rankName(ranks[1])})`
    case 'Four of a Kind':    return `Four of a Kind (${rankName(ranks[0])})`
    case 'Straight Flush':    return ranks[0] === 14 ? 'Royal Flush' : `Straight Flush (${rankName(ranks[0])} high)`
  }
}

/**
 * When two hands share a category, describes the rank that decided between them.
 * Returns null for a true split pot.
 */
export function tiebreakDescription(winner: HandEvaluation, runnerUp: HandEvaluation): string | null {
  for (let i = 0; i < Math.max(winner.ranks.length, runnerUp.ranks.length); i++) {
    const a = winner.ranks[i] ?? 0
    const b = runnerUp.ranks[i] ?? 0
    if (a !== b) return `${rankName(a)} kicker`
  }
  return null
}

export interface StrengthBar {
  percent: number
  color: string
  verdict: string
}

const STRENGTH_BY_CATEGORY: StrengthBar[] = [
  { percent: 10,  color: '#e74c3c', verdict: 'weak' },        // High Card
  { percent: 25,  color: '#e74c3c', verdict: 'weak' },        // Pair
  { percent: 40,  color: '#e67e22', verdict: 'decent' },      // Two Pair
  { percent: 50,  color: '#e67e22', verdict: 'decent' },      // Three of a Kind
  { percent: 65,  color: '#f1c40f', verdict: 'strong' },      // Straight
  { percent: 75,  color: '#f1c40f', verdict: 'strong' },      // Flush
  { percent: 88,  color: '#2ecc71', verdict: 'very strong' }, // Full House
  { percent: 95,  color: '#2ecc71', verdict: 'very strong' }, // Four of a Kind
  { percent: 100, color: '#2ecc71', verdict: 'very strong' }, // Straight Flush
]

export function strengthBar(evaluation: HandEvaluation): StrengthBar {
  return STRENGTH_BY_CATEGORY[evaluation.categoryIndex]
}

const CHEN_BASE: Record<number, number> = {
  14: 10, 13: 8, 12: 7, 11: 6, 10: 5,
  9: 4.5, 8: 4, 7: 3.5, 6: 3, 5: 2.5, 4: 2, 3: 1.5, 2: 1,
}

/**
 * Preflop-only strength bar using a variant of the Chen Formula
 * (pair/suited/connector bonuses, gap penalties).
 */
export function preflopStrength(cards: Card[]): StrengthBar {
  const [hi, lo] = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a)
  const isPair = hi === lo
  const isSuited = cards[0].suit === cards[1].suit

  let score = CHEN_BASE[hi]

  if (isPair) {
    score = Math.max(score * 2, 5)
  } else {
    if (isSuited) score += 2
    const gap = hi - lo - 1
    if (gap === 1) score -= 1
    else if (gap === 2) score -= 2
    else if (gap === 3) score -= 4
    else if (gap >= 4) score -= 5
    if (gap <= 1 && hi <= 12) score += 1
  }

  score = Math.ceil(score)
  const percent = Math.min(100, Math.max(0, (score / 20) * 100))

  if (score >= 12) return { percent, color: '#2ecc71', verdict: 'very strong' }
  if (score >= 9)  return { percent, color: '#f1c40f', verdict: 'strong' }
  if (score >= 7)  return { percent, color: '#e67e22', verdict: 'decent' }
  return { percent, color: '#e74c3c', verdict: 'weak' }
}

/** Board texture warnings based on community cards vs. current hand strength. */
export function boardConcerns(evaluation: HandEvaluation, communityCards: Card[]): string[] {
  if (communityCards.length < 3) return []
  const concerns: string[] = []

  const suitCounts = new Map<string, number>()
  for (const card of communityCards) {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1)
  }
  if ([...suitCounts.values()].some((n) => n >= 3) && evaluation.categoryIndex < 5) {
    concerns.push('Note: the board allows a possible flush.')
  }

  const communityValues = [...new Set(communityCards.map((c) => rankValue(c.rank)))]
  if (communityValues.includes(14)) communityValues.push(1) // treat Ace as low for straight detection
  communityValues.sort((a, b) => a - b)
  let hasRunOfThree = false
  for (let i = 0; i <= communityValues.length - 3; i++) {
    if (communityValues[i + 2] - communityValues[i] <= 4) { hasRunOfThree = true; break }
  }
  if (hasRunOfThree && evaluation.categoryIndex < 4) {
    concerns.push('Note: the board allows a possible straight.')
  }

  const rankCounts = new Map<number, number>()
  for (const card of communityCards) {
    const v = rankValue(card.rank)
    rankCounts.set(v, (rankCounts.get(v) ?? 0) + 1)
  }
  if ([...rankCounts.values()].some((n) => n >= 2) && evaluation.categoryIndex < 6 && evaluation.categoryIndex !== 7) {
    concerns.push('Note: the board is paired — a full house or better may be possible.')
  }

  return concerns
}
