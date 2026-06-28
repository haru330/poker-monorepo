/**
 * Quick sanity check: print what hands land in each tier and verify counts.
 * Run: npx tsx src/ranges.test.ts
 */
import { handStrengthScore, comboMatchesTier, TIER_THRESHOLDS } from './ranges'
import type { Card } from './types'

console.log('Tier score thresholds:', TIER_THRESHOLDS)

// Count combos per tier using the standard deck
const RANK_STRS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'] as const
const SUIT_STRS = ['spades','hearts','diamonds','clubs'] as const
const deck: Card[] = []
for (const rank of RANK_STRS) for (const suit of SUIT_STRS) deck.push({ rank, suit })

let raise = 0, call = 0, check = 0, any = 0
for (let i = 0; i < deck.length; i++) {
  for (let j = i + 1; j < deck.length; j++) {
    const c1 = deck[i], c2 = deck[j]
    if (comboMatchesTier(c1, c2, 'raise'))      raise++
    else if (comboMatchesTier(c1, c2, 'call'))  call++
    else if (comboMatchesTier(c1, c2, 'check')) check++
    else                                         any++
  }
}
const total = raise + call + check + any
console.log(`\nTotal combos: ${total} (should be 1326)`)
console.log(`Raise: ${raise} (${(raise/total*100).toFixed(1)}%) — expected ~20%`)
console.log(`Call:  ${call}  (${(call/total*100).toFixed(1)}%) — expected ~25% (20→45%)`)
console.log(`Check: ${check} (${(check/total*100).toFixed(1)}%) — expected ~25% (45→70%)`)
console.log(`Any:   ${any}  (${(any/total*100).toFixed(1)}%) — expected ~30%`)

// Print representative hands at tier boundaries
console.log('\n--- Raise tier sample hands (strongest 20%) ---')
const pct = (c1: Card, c2: Card) => {
  const r1 = c1.rank, r2 = c2.rank
  const suited = c1.suit === c2.suit
  if (r1 === r2) return `${r1}${r1}`
  const byVal = [c1,c2].sort((a,b) => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].indexOf(b.rank) - ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].indexOf(a.rank))
  return `${byVal[0].rank}${byVal[1].rank}${suited?'s':'o'}`
}

// Find the boundary — weakest hand in raise tier
const allCombos: { key: string; score: number }[] = []
const seen = new Set<string>()
for (let i = 0; i < deck.length; i++) {
  for (let j = i + 1; j < deck.length; j++) {
    const key = pct(deck[i], deck[j])
    if (!seen.has(key)) {
      seen.add(key)
      allCombos.push({ key, score: handStrengthScore(deck[i], deck[j]) })
    }
  }
}
allCombos.sort((a,b) => b.score - a.score)

console.log('Top 20 hand types (raise range start):')
allCombos.slice(0, 20).forEach(h => console.log(`  ${h.key.padEnd(6)} score=${h.score}`))

// Find where raise tier ends
const raiseThreshold = TIER_THRESHOLDS.raise
const callThreshold  = TIER_THRESHOLDS.call
console.log(`\nWeakest hands IN raise tier (score >= ${raiseThreshold}):`)
const raiseHands = allCombos.filter(h => h.score >= raiseThreshold).slice(-5)
raiseHands.forEach(h => console.log(`  ${h.key.padEnd(6)} score=${h.score}`))

console.log(`\nStrongest hands NOT in raise tier (score < ${raiseThreshold}):`)
const callBoundary = allCombos.filter(h => h.score >= callThreshold && h.score < raiseThreshold).slice(0, 5)
callBoundary.forEach(h => console.log(`  ${h.key.padEnd(6)} score=${h.score}`))

// Validate specific hands
const testCases: [string, string, string, string, 'raise'|'call'|'check'|'any'][] = [
  ['A', 'A', 'spades', 'hearts', 'raise'],   // AA → raise ✓
  ['K', 'K', 'clubs', 'diamonds', 'raise'],  // KK → raise ✓
  ['7', '2', 'spades', 'hearts', 'any'],     // 72o → any ✓
  ['A', 'K', 'spades', 'hearts', 'raise'],   // AKs → raise ✓
  ['A', 'K', 'spades', 'clubs', 'raise'],    // AKo → raise ✓
  ['J', '10', 'hearts', 'hearts', 'raise'],  // JTs → raise (suited connector, score 182) ✓
  ['2', '7', 'clubs', 'diamonds', 'any'],    // 72o → any (worst hand) ✓
]

console.log('\n--- Specific hand validation ---')
let allPass = true
for (const [r1, r2, s1, s2, expected] of testCases) {
  const c1 = { rank: r1 as Card['rank'], suit: s1 as Card['suit'] }
  const c2 = { rank: r2 as Card['rank'], suit: s2 as Card['suit'] }
  const score = handStrengthScore(c1, c2)
  const inRaise = comboMatchesTier(c1, c2, 'raise')
  const inCall  = comboMatchesTier(c1, c2, 'call')
  const inCheck = comboMatchesTier(c1, c2, 'check')
  const actual = inRaise ? 'raise' : inCall ? 'call' : inCheck ? 'check' : 'any'
  const pass = actual === expected
  if (!pass) allPass = false
  const hand = pct(c1, c2)
  console.log(`  ${hand.padEnd(6)} score=${String(score).padStart(3)}  tier=${actual.padEnd(6)} ${pass ? '✅' : `❌ expected ${expected}`}`)
}
if (allPass) console.log('\n✅ All hand tier assertions pass')
else console.log('\n❌ Some hand tier assertions failed')
