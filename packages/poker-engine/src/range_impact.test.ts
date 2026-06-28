/**
 * Demonstrates that preflop actions shift range equity numbers.
 * Run: npx tsx src/range_impact.test.ts
 */
import { dealNewHand, applyAction } from './gameState'
import { recomputeRangeEquity } from './equity'
import type { GameState } from './types'

function makeInitialState(): GameState {
  return {
    roomCode: 'TEST',
    players: ['Alice','Bob','Carol','Dave','Eve'].map((name,i) => ({
      id: `p${i}`, name, chips: 100, hand: [],
      status: 'connected', hasFolded: false, isAllIn: false, isHost: i===0,
      streetContribution: 0, totalContribution: 0, hasActed: false,
    })),
    deck: [], communityCards: [], street: 'preflop', pots: [],
    dealerButtonIndex: -1, currentTurnPlayerId: null,
    currentBet: 0, minRaise: 2, startingChips: 100,
    currentAnte: 2, startingAnte: 2, handsPerLevel: 5, handNumber: 0,
    actionLog: [], results: null, equity: null, lastAllInCallerId: null,
    preflopAction: {},
  }
}

const pct = (n: number) => `${(n*100).toFixed(1)}%`

// Deal a hand
let state = dealNewHand(makeInitialState())
console.log('Players dealt:')
state.players.forEach(p => console.log(`  ${p.name}: ${p.hand.map(c=>c.rank+c.suit[0]).join(',')}`))

// Show baseline range equity (before any action — all "any" range)
const baseFlop = state.equity?.range.flop ?? []
console.log('\nBaseline range equity (flop, pre-action — all vs random hands):')
baseFlop.forEach(r => {
  const name = state.players.find(p=>p.id===r.playerId)?.name
  console.log(`  ${name?.padEnd(6)}: win=${pct(r.win)} tie=${pct(r.tie)}`)
})

// Simulate: first player (first to act) RAISES
const firstToAct = state.players.find(p => p.id === state.currentTurnPlayerId)!
console.log(`\n${firstToAct.name} raises (preflop)...`)
state = applyAction(state, { playerId: firstToAct.id, type: 'raise', amount: 10 })
console.log('preflopAction:', state.preflopAction)

// Everyone else checks/calls until preflop is done
let iterations = 0
while (state.street === 'preflop' && state.currentTurnPlayerId && iterations < 20) {
  const p = state.players.find(pl => pl.id === state.currentTurnPlayerId)!
  const owed = state.currentBet - p.streetContribution
  const action = owed > 0 ? 'call' : 'check'
  state = applyAction(state, { playerId: p.id, type: action })
  iterations++
}

console.log(`\nAfter preflop (${iterations} actions), street is now: ${state.street}`)
console.log('preflopActions recorded:', state.preflopAction)

// Now manually trigger range recompute as if we just transitioned to flop
const recomputed = recomputeRangeEquity(state)!

console.log('\n--- Range equity BEFORE recompute (all vs random): ---')
state.equity?.range.flop.forEach(r => {
  const name = state.players.find(p=>p.id===r.playerId)?.name
  const tier = state.preflopAction[r.playerId] ?? 'any'
  console.log(`  ${name?.padEnd(6)} [${tier.padEnd(5)}]: win=${pct(r.win)} tie=${pct(r.tie)}`)
})

console.log('\n--- Range equity AFTER recompute (range-filtered): ---')
recomputed.range.flop.forEach(r => {
  const name = state.players.find(p=>p.id===r.playerId)?.name
  const tier = state.preflopAction[r.playerId] ?? 'any'
  console.log(`  ${name?.padEnd(6)} [${tier.padEnd(5)}]: win=${pct(r.win)} tie=${pct(r.tie)}`)
})

// Assertions
console.log('\n--- Validation ---')
const raiserId = firstToAct.id
const raiserBefore = state.equity?.range.flop.find(r=>r.playerId===raiserId)!
const raiserAfter  = recomputed.range.flop.find(r=>r.playerId===raiserId)!

// A raiser's range equity should be higher after narrowing (they're credited with raising range)
// Callers' equity vs the raiser should shift to reflect they're facing a stronger range
console.log(`${firstToAct.name} (raiser) before: ${pct(raiserBefore.win)} → after: ${pct(raiserAfter.win)}`)

// Check that the recompute runs without error and produces non-null values
const allNonZero = recomputed.range.flop.some(r => r.win > 0.01)
console.log(allNonZero
  ? '✅ Recomputed range equity has non-zero values'
  : '❌ All range equity values are zero')

// The raiser's range equity should be non-trivially high (raise range is strong hands)
console.log(raiserAfter.win > 0.1
  ? `✅ Raiser range equity ${pct(raiserAfter.win)} is substantial`
  : `❌ Raiser range equity ${pct(raiserAfter.win)} seems too low`)

console.log('\nDone.')
