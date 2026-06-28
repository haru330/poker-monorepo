/**
 * Equity verification script — run with: npx tsx src/equity.test.ts
 *
 * Sets up 5 known hands + board, predicts expected winners, then checks
 * precomputeEquity() output against those expectations.
 */

import { precomputeEquity } from './equity'
import { evaluateHand, compareHands } from './handEvaluator'
import { describeHand } from './presentation'
import type { Card, GameState, Player } from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function c(rank: string, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

function makePlayer(id: string, name: string, hand: Card[]): Player {
  return {
    id, name, chips: 100, hand, status: 'connected',
    hasFolded: false, isAllIn: false, isHost: false,
    streetContribution: 0, totalContribution: 0, hasActed: false,
  }
}

// Build a fake GameState where the remaining deck has the board cards at the END
// (matching how precomputeEquity peeks: d[n-1]=flop1, d[n-2]=flop2, d[n-3]=flop3,
//  d[n-4]=turn, d[n-5]=river)
function makeState(players: Player[], flop: Card[], turn: Card, river: Card): GameState {
  // All 52 cards
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'] as const
  const suits = ['spades','hearts','diamonds','clubs'] as const
  const all52: Card[] = []
  for (const s of suits) for (const r of ranks) all52.push({ rank: r, suit: s })

  // Cards already dealt out
  const usedKeys = new Set<string>()
  const key = (c: Card) => `${c.rank}|${c.suit}`
  for (const p of players) for (const card of p.hand) usedKeys.add(key(card))
  for (const card of [...flop, turn, river]) usedKeys.add(key(card))

  // Remaining deck: filler cards first, then river, turn, flop3, flop2, flop1 at the end
  const filler = all52.filter(c => !usedKeys.has(key(c)))
  const deck: Card[] = [
    ...filler,
    river,   // d[n-5] — peeked as river
    turn,    // d[n-4] — peeked as turn
    flop[2], // d[n-3] — peeked as flop card 3
    flop[1], // d[n-2]
    flop[0], // d[n-1]
  ]

  return {
    roomCode: 'TEST',
    players,
    deck,
    communityCards: [],
    street: 'preflop',
    pots: [{ id: 'main', amount: 10, eligiblePlayerIds: players.map(p => p.id) }],
    dealerButtonIndex: 0,
    currentTurnPlayerId: players[0].id,
    currentBet: 0, minRaise: 2,
    startingChips: 100, currentAnte: 2, startingAnte: 2, handsPerLevel: 5,
    handNumber: 1,
    actionLog: [],
    results: null,
    equity: null,
    lastAllInCallerId: null,
    preflopAction: {},
  }
}

function pct(n: number) { return `${(n * 100).toFixed(1)}%` }

function printEquityTable(label: string, results: import('./equity').EquityResult[], players: Player[]) {
  console.log(`\n  ${label}:`)
  for (const r of results) {
    const name = players.find(p => p.id === r.playerId)?.name ?? r.playerId
    console.log(`    ${name.padEnd(8)}: win=${pct(r.win)}  tie=${pct(r.tie)}  total=${pct(r.win + r.tie)}`)
  }
}

function groundTruth(players: Player[], community: Card[]) {
  const evals = players.map(p => ({ name: p.name, ev: evaluateHand([...p.hand, ...community]) }))
  let best = evals[0].ev
  for (const e of evals) if (compareHands(e.ev, best) > 0) best = e.ev
  const winners = evals.filter(e => compareHands(e.ev, best) === 0).map(e => e.name)
  return evals.map(e => ({ name: e.name, hand: describeHand(e.ev) })).concat([]).map(e => e), winners
}

// ── Scenario 1: Classic domination — AA vs KK vs QQ vs JJ vs 72o ─────────────

console.log('\n╔══════════════════════════════════════════════════════════╗')
console.log('║  SCENARIO 1: AA vs KK vs QQ vs JJ vs 72o               ║')
console.log('║  Flop: A♣ K♦ Q♣  Turn: J♦  River: 2♠                  ║')
console.log('║  Expected: Alice=Set(A), Bob=Set(K), Carol=Set(Q)       ║')
console.log('║  At river: Alice has full house AAAKK  — Alice wins     ║')
console.log('╚══════════════════════════════════════════════════════════╝')

{
  const players = [
    makePlayer('p0', 'Alice', [c('A','spades'), c('A','hearts')]),
    makePlayer('p1', 'Bob',   [c('K','spades'), c('K','hearts')]),
    makePlayer('p2', 'Carol', [c('Q','spades'), c('Q','hearts')]),
    makePlayer('p3', 'Dave',  [c('J','spades'), c('J','hearts')]),
    makePlayer('p4', 'Eve',   [c('7','spades'), c('2','hearts')]),
  ]
  const flop   = [c('A','clubs'), c('K','diamonds'), c('Q','clubs')]
  const turn   = c('J','diamonds')
  const river  = c('2','spades')
  const board  = [...flop, turn, river]

  console.log('\nGround truth at each street:')
  const evalPlayers = (comm: Card[]) => {
    const rows = players.map(p => {
      const ev = evaluateHand([...p.hand, ...comm])
      return { name: p.name, hand: describeHand(ev) }
    })
    let best = evaluateHand([...players[0].hand, ...comm])
    for (const p of players) {
      const ev = evaluateHand([...p.hand, ...comm])
      if (compareHands(ev, best) > 0) best = ev
    }
    const winners = players.filter(p => compareHands(evaluateHand([...p.hand, ...comm]), best) === 0).map(p => p.name)
    for (const r of rows) console.log(`  ${r.name.padEnd(8)}: ${r.hand}`)
    console.log(`  → Winner(s): ${winners.join(', ')}`)
  }

  console.log('\nFlop (A♣K♦Q♣):')
  evalPlayers(flop)
  console.log('\nTurn (+ J♦):')
  evalPlayers([...flop, turn])
  console.log('\nRiver (+ 2♠):')
  evalPlayers(board)

  const state = makeState(players, flop, turn, river)
  const eq = precomputeEquity(state)

  console.log('\nSpectator equity (exact enumeration):')
  printEquityTable('Flop  (A heads up: who wins more turn/river combos?)', eq.spectator.flop, players)
  printEquityTable('Turn  (A best; B vs C split river)', eq.spectator.turn, players)
  printEquityTable('River (Alice should be ~100%)', eq.spectator.river, players)

  console.log('\nRange equity (Monte Carlo vs random opponents):')
  printEquityTable('Flop  range', eq.range.flop, players)
  printEquityTable('Turn  range', eq.range.turn, players)
  printEquityTable('River range', eq.range.river, players)

  // Assertions
  const riverWin = eq.spectator.river.find(r => r.playerId === 'p0')!
  const riverTotal = riverWin.win + riverWin.tie
  if (Math.abs(riverTotal - 1.0) < 0.001) {
    console.log('\n✅  Alice spectator river equity = 100% (correct — full house beats all)')
  } else {
    console.log(`\n❌  Alice spectator river equity = ${pct(riverTotal)} (expected ~100%)`)
  }

  const totalSpecFlop = eq.spectator.flop.reduce((s, r) => s + r.win + r.tie, 0)
  if (Math.abs(totalSpecFlop - 1.0) < 0.01) {
    console.log('✅  Spectator flop equities sum to ~100%')
  } else {
    console.log(`❌  Spectator flop equities sum to ${pct(totalSpecFlop)} (expected ~100%)`)
  }

  const totalRangeFlop = eq.range.flop.reduce((s, r) => s + r.win + r.tie, 0)
  if (totalRangeFlop > 0.1) {
    console.log(`✅  Range flop equities are non-zero (sum=${pct(totalRangeFlop)})`)
  } else {
    console.log(`❌  Range flop equities all zero! sum=${pct(totalRangeFlop)} — BUG`)
  }

  const aliceRangeFlop = eq.range.flop.find(r => r.playerId === 'p0')!
  const eveRangeFlop   = eq.range.flop.find(r => r.playerId === 'p4')!
  if (aliceRangeFlop.win > eveRangeFlop.win) {
    console.log(`✅  Alice range flop (${pct(aliceRangeFlop.win)}) > Eve range flop (${pct(eveRangeFlop.win)}) (correct)`)
  } else {
    console.log(`❌  Alice range (${pct(aliceRangeFlop.win)}) should beat Eve range (${pct(eveRangeFlop.win)})`)
  }
}

// ── Scenario 2: Flush draw vs pair vs straight draw ───────────────────────────

console.log('\n\n╔══════════════════════════════════════════════════════════╗')
console.log('║  SCENARIO 2: Flush draw vs Two-pair vs Straight draw    ║')
console.log('║  Alice: A♥ K♥  Bob: 8♠ 8♦  Carol: 9♣ T♣  Dave: 5♣ 6♣  ║')
console.log('║  Flop: 7♥ 8♥ J♥  Turn: 3♥  River: 2♦                   ║')
console.log('║  Alice: nut flush (A♥ high)  Bob: set of 8s             ║')
console.log('║  At river: Alice nut flush beats Bob set                ║')
console.log('╚══════════════════════════════════════════════════════════╝')

{
  const players = [
    makePlayer('p0', 'Alice', [c('A','hearts'), c('K','hearts')]),
    makePlayer('p1', 'Bob',   [c('8','clubs'),  c('8','diamonds')]),
    makePlayer('p2', 'Carol', [c('9','spades'), c('10','spades')]),
    makePlayer('p3', 'Dave',  [c('5','clubs'),  c('6','clubs')]),
  ]
  const flop  = [c('7','hearts'), c('8','hearts'), c('J','hearts')]
  const turn  = c('3','hearts')
  const river = c('2','diamonds')
  const board = [...flop, turn, river]

  console.log('\nGround truth:')
  console.log('Flop:')
  for (const p of players) {
    const ev = evaluateHand([...p.hand, ...flop])
    console.log(`  ${p.name.padEnd(8)}: ${describeHand(ev)}`)
  }
  console.log('River:')
  for (const p of players) {
    const ev = evaluateHand([...p.hand, ...board])
    console.log(`  ${p.name.padEnd(8)}: ${describeHand(ev)}`)
  }

  const state = makeState(players, flop, turn, river)
  const eq = precomputeEquity(state)

  printEquityTable('Spectator Flop', eq.spectator.flop, players)
  printEquityTable('Spectator Turn', eq.spectator.turn, players)
  printEquityTable('Spectator River', eq.spectator.river, players)
  printEquityTable('Range Flop', eq.range.flop, players)
  printEquityTable('Range Turn', eq.range.turn, players)
  printEquityTable('Range River', eq.range.river, players)

  const aliceRiver = eq.spectator.river.find(r => r.playerId === 'p0')!
  if (Math.abs(aliceRiver.win - 1.0) < 0.001) {
    console.log('\n✅  Alice spectator river = 100% (nut flush wins)')
  } else {
    console.log(`\n❌  Alice spectator river = ${pct(aliceRiver.win)} (expected 100%)`)
  }

  // At the flop, Alice has flush DRAW not made flush yet (4 hearts)
  // So spectator flop should give Alice high but not 100%
  const aliceFlop = eq.spectator.flop.find(r => r.playerId === 'p0')!
  if (aliceFlop.win > 0.4 && aliceFlop.win < 1.0) {
    console.log(`✅  Alice spectator flop = ${pct(aliceFlop.win)} (high equity from nut flush draw, not 100%)`)
  } else {
    console.log(`❓  Alice spectator flop = ${pct(aliceFlop.win)} (maybe check this)`)
  }
}

// ── Scenario 3: Split pot — identical hands ────────────────────────────────────

console.log('\n\n╔══════════════════════════════════════════════════════════╗')
console.log('║  SCENARIO 3: Guaranteed split — board plays best hand   ║')
console.log('║  Alice: 2♠ 3♠  Bob: 2♥ 3♥  (both use board)           ║')
console.log('║  Board: A♦ A♣ A♥ K♦ K♣  (full house on board)         ║')
console.log('║  Both players play the board → 50/50 tie always        ║')
console.log('╚══════════════════════════════════════════════════════════╝')

{
  const players = [
    makePlayer('p0', 'Alice', [c('2','spades'), c('3','spades')]),
    makePlayer('p1', 'Bob',   [c('2','hearts'), c('3','hearts')]),
  ]
  const flop  = [c('A','diamonds'), c('A','clubs'), c('A','hearts')]
  const turn  = c('K','diamonds')
  const river = c('K','clubs')

  const state = makeState(players, flop, turn, river)
  const eq = precomputeEquity(state)

  printEquityTable('Spectator River', eq.spectator.river, players)

  const aliceTie = eq.spectator.river.find(r => r.playerId === 'p0')!
  const bobTie   = eq.spectator.river.find(r => r.playerId === 'p1')!
  // With fractional tie credits: each of 2 players gets 0.5 share → 50% each, sum=100%
  if (aliceTie.win < 0.001 && bobTie.win < 0.001 && Math.abs(aliceTie.tie - 0.5) < 0.001) {
    console.log('\n✅  Both 0% win, 50% tie each (correct — 50/50 split of the pot)')
    console.log(`    Sum: ${pct(aliceTie.tie + bobTie.tie)} (should be 100%)`)
  } else {
    console.log(`\n❌  Alice: win=${pct(aliceTie.win)} tie=${pct(aliceTie.tie)}  Bob: win=${pct(bobTie.win)} tie=${pct(bobTie.tie)}`)
  }
}

console.log('\n\nDone.\n')
