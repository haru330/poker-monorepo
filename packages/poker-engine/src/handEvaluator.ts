import type { Card, Rank } from './types'

export const HAND_CATEGORIES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const

export type HandCategory = (typeof HAND_CATEGORIES)[number]

export interface HandEvaluation {
  category: HandCategory
  categoryIndex: number // 0 (High Card) .. 8 (Straight Flush)
  /** Tiebreak ranks in priority order, e.g. Full House -> [tripValue, pairValue]. */
  ranks: number[]
  /** The 5 cards that make up this hand, for highlighting. */
  cards: Card[]
  /**
   * The subset of `cards` that defines the category itself (e.g. the pair or trips),
   * as opposed to kickers. Empty for High Card.
   */
  comboCards: Card[]
}

const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
}

export function rankValue(rank: Rank): number {
  return RANK_VALUES[rank]
}

/** Returns >0 if a beats b, <0 if b beats a, 0 if tied. */
export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.categoryIndex !== b.categoryIndex) return a.categoryIndex - b.categoryIndex
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Evaluates the best 5-card hand from 2–7 cards.
 * With fewer than 5 cards (preflop) falls back to a simple Pair/High Card read.
 */
export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) return evaluatePartial(cards)

  let best: HandEvaluation | null = null
  for (const combo of combinations(cards, 5)) {
    const evaluation = evaluate5(combo)
    if (!best || compareHands(evaluation, best) > 0) best = evaluation
  }
  return best!
}

function evaluatePartial(cards: Card[]): HandEvaluation {
  if (cards.length === 2 && rankValue(cards[0].rank) === rankValue(cards[1].rank)) {
    return { category: 'Pair', categoryIndex: 1, ranks: [rankValue(cards[0].rank)], cards, comboCards: cards }
  }
  const sorted = [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank))
  return {
    category: 'High Card',
    categoryIndex: 0,
    ranks: sorted.map((c) => rankValue(c.rank)),
    cards: sorted.slice(0, 1),
    comboCards: [],
  }
}

function evaluate5(cards: Card[]): HandEvaluation {
  const sorted = [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank))

  const byValue = new Map<number, Card[]>()
  for (const card of sorted) {
    const v = rankValue(card.rank)
    const list = byValue.get(v) ?? []
    list.push(card)
    byValue.set(v, list)
  }

  const groups = [...byValue.entries()]
    .map(([value, group]) => ({ value, group }))
    .sort((a, b) => (b.group.length - a.group.length) || (b.value - a.value))

  const isFlush = sorted.every((c) => c.suit === sorted[0].suit)
  const straightHigh = straightHighCard(sorted.map((c) => rankValue(c.rank)))

  if (isFlush && straightHigh !== null) {
    const hand = pickStraightCards(sorted, straightHigh)
    return { category: 'Straight Flush', categoryIndex: 8, ranks: [straightHigh], cards: hand, comboCards: hand }
  }

  if (groups[0].group.length === 4) {
    const kicker = groups[1].value
    return {
      category: 'Four of a Kind',
      categoryIndex: 7,
      ranks: [groups[0].value, kicker],
      cards: [...groups[0].group, groups[1].group[0]],
      comboCards: groups[0].group,
    }
  }

  if (groups[0].group.length === 3 && groups[1].group.length >= 2) {
    const hand = [...groups[0].group, ...groups[1].group.slice(0, 2)]
    return { category: 'Full House', categoryIndex: 6, ranks: [groups[0].value, groups[1].value], cards: hand, comboCards: hand }
  }

  if (isFlush) {
    return { category: 'Flush', categoryIndex: 5, ranks: sorted.map((c) => rankValue(c.rank)), cards: sorted, comboCards: sorted }
  }

  if (straightHigh !== null) {
    const hand = pickStraightCards(sorted, straightHigh)
    return { category: 'Straight', categoryIndex: 4, ranks: [straightHigh], cards: hand, comboCards: hand }
  }

  if (groups[0].group.length === 3) {
    const kickers = groups.slice(1).flatMap((g) => g.group).slice(0, 2)
    return {
      category: 'Three of a Kind',
      categoryIndex: 3,
      ranks: [groups[0].value, ...kickers.map((c) => rankValue(c.rank))],
      cards: [...groups[0].group, ...kickers],
      comboCards: groups[0].group,
    }
  }

  if (groups[0].group.length === 2 && groups[1].group.length === 2) {
    const kicker = groups[2].group[0]
    return {
      category: 'Two Pair',
      categoryIndex: 2,
      ranks: [groups[0].value, groups[1].value, rankValue(kicker.rank)],
      cards: [...groups[0].group, ...groups[1].group, kicker],
      comboCards: [...groups[0].group, ...groups[1].group],
    }
  }

  if (groups[0].group.length === 2) {
    const kickers = groups.slice(1).flatMap((g) => g.group).slice(0, 3)
    return {
      category: 'Pair',
      categoryIndex: 1,
      ranks: [groups[0].value, ...kickers.map((c) => rankValue(c.rank))],
      cards: [...groups[0].group, ...kickers],
      comboCards: groups[0].group,
    }
  }

  return { category: 'High Card', categoryIndex: 0, ranks: sorted.map((c) => rankValue(c.rank)), cards: sorted, comboCards: [] }
}

/** Returns the high card value of a straight among `values`, or null. Handles the wheel (A-2-3-4-5). */
function straightHighCard(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a)
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) return unique[i]
  }
  if ([14, 5, 4, 3, 2].every((v) => unique.includes(v))) return 5
  return null
}

function pickStraightCards(sorted: Card[], high: number): Card[] {
  const wanted = high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4]
  const result: Card[] = []
  for (const value of wanted) {
    const card = sorted.find((c) => rankValue(c.rank) === value && !result.includes(c))
    if (card) result.push(card)
  }
  return result
}

function* combinations<T>(items: T[], k: number): Generator<T[]> {
  const n = items.length
  const indices = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield indices.map((i) => items[i])
    let i = k - 1
    while (i >= 0 && indices[i] === n - k + i) i--
    if (i < 0) return
    indices[i]++
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1
  }
}
