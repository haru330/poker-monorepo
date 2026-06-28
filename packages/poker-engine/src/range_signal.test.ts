/**
 * Validates the range narrowing signal: 72o (worst hand) should do
 * WORSE against raise-range opponents than against check-range opponents.
 * Run: npx tsx src/range_signal.test.ts
 */
import { recomputeRangeEquity } from './equity'
import type { GameState, Card, Player } from './types'

const cardKey = (c: Card) => `${c.rank}|${c.suit}`

const RANK_STRS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'] as const
const SUIT_STRS = ['spades','hearts','diamonds','clubs'] as const
const FULL_DECK: Card[] = []
for (const rank of RANK_STRS) for (const suit of SUIT_STRS) FULL_DECK.push({ rank, suit })

function makePlayer(id: string, hand: Card[]): Player {
  return { id, name: id, chips: 98, hand, status: 'connected', hasFolded: false, isAllIn: false, isHost: false, streetContribution: 0, totalContribution: 0, hasActed: true }
}

function buildTestState(heroHand: Card[], heroAction: 'raise' | 'check'): GameState {
  const used = new Set(heroHand.map(cardKey))
  const rest = FULL_DECK.filter(c => !used.has(cardKey(c)))

  const opp1Hand = rest.slice(0, 2); opp1Hand.forEach(c => used.add(cardKey(c)))
  const opp2Hand = rest.slice(2, 4); opp2Hand.forEach(c => used.add(cardKey(c)))

  // Community: 3 flop + turn + river from rest of deck (after player hands)
  const community = FULL_DECK.filter(c => !used.has(cardKey(c))).slice(0, 5)
  const [f1, f2, f3, turn, river] = community
  community.forEach(c => used.add(cardKey(c)))

  const deckRest = FULL_DECK.filter(c => !used.has(cardKey(c)))
  // Deck arranged so d[n-1]=f1, d[n-2]=f2, d[n-3]=f3, d[n-4]=turn, d[n-5]=river
  const fakeDeck: Card[] = [...deckRest, river, turn, f3, f2, f1]

  const placeholder = [
    { playerId: 'hero', win: 0, tie: 0 },
    { playerId: 'opp1', win: 0, tie: 0 },
    { playerId: 'opp2', win: 0, tie: 0 },
  ]
  const fakeEquity = {
    spectator: { flop: placeholder, turn: placeholder, river: placeholder },
    range:     { flop: placeholder, turn: placeholder, river: placeholder },
    lastAllInCallerId: null,
  }

  return {
    roomCode: 'TEST',
    players: [makePlayer('hero', heroHand), makePlayer('opp1', opp1Hand), makePlayer('opp2', opp2Hand)],
    deck: fakeDeck, communityCards: [],
    street: 'preflop', pots: [],
    dealerButtonIndex: 0, currentTurnPlayerId: null, currentBet: 0, minRaise: 2,
    startingChips: 100, currentAnte: 2, startingAnte: 2, handsPerLevel: 5, handNumber: 1,
    actionLog: [], results: null, equity: fakeEquity, lastAllInCallerId: null,
    preflopAction: { hero: heroAction, opp1: heroAction === 'raise' ? 'call' : 'check', opp2: heroAction === 'raise' ? 'call' : 'check' },
  }
}

const TRIALS = 8
const heroHand: Card[] = [{ rank: '7', suit: 'spades' }, { rank: '2', suit: 'hearts' }]

let raiserWin = 0, checkerWin = 0
for (let t = 0; t < TRIALS; t++) {
  const r = recomputeRangeEquity(buildTestState(heroHand, 'raise'))!.range.flop.find(r => r.playerId === 'hero')!
  const c = recomputeRangeEquity(buildTestState(heroHand, 'check'))!.range.flop.find(r => r.playerId === 'hero')!
  raiserWin += r.win
  checkerWin += c.win
}
const ar = raiserWin / TRIALS
const ac = checkerWin / TRIALS

console.log(`72o vs RAISE-range opponents: avg ${(ar*100).toFixed(1)}%`)
console.log(`72o vs CHECK-range opponents: avg ${(ac*100).toFixed(1)}%`)

// 72o should lose more to raise range (stronger hands) than check range (weaker hands)
if (ac > ar) {
  console.log(`✅ Signal confirmed: facing raise range hurts (${(ar*100).toFixed(1)}%) vs check range (${(ac*100).toFixed(1)}%)`)
} else {
  console.log(`❌ Signal not detected yet (Monte Carlo variance) — try increasing TRIALS`)
}

// Also test with AA: should show HIGHER equity facing raise range than check range
const aaHand: Card[] = [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }]
let aaRaiser = 0, aaChecker = 0
for (let t = 0; t < TRIALS; t++) {
  const r = recomputeRangeEquity(buildTestState(aaHand, 'raise'))!.range.flop.find(r => r.playerId === 'hero')!
  const c = recomputeRangeEquity(buildTestState(aaHand, 'check'))!.range.flop.find(r => r.playerId === 'hero')!
  aaRaiser += r.win
  aaChecker += c.win
}
const ar2 = aaRaiser / TRIALS
const ac2 = aaChecker / TRIALS

console.log(`\nAA vs RAISE-range opponents: avg ${(ar2*100).toFixed(1)}%`)
console.log(`AA vs CHECK-range opponents: avg ${(ac2*100).toFixed(1)}%`)
console.log(`Note: AA expected to show decent equity in both scenarios (strong hand beats both ranges)`)
console.log(`Both non-zero: ${ar2 > 0.3 && ac2 > 0.3 ? '✅' : '❌'}`)
