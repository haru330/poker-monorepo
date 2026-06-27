import type { Action, ActionLogEntry, GameState, Player, Pot, ShowdownResult, Street } from './types'
import { freshDeck, shuffle } from './deck'
import { compareHands, evaluateHand } from './handEvaluator'
import { describeHand, tiebreakDescription } from './presentation'

function logEntry(message: string): ActionLogEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, message }
}

function nextActiveIndex(players: Player[], fromIndex: number, predicate: (p: Player) => boolean): number {
  for (let offset = 1; offset <= players.length; offset++) {
    const idx = (fromIndex + offset) % players.length
    if (predicate(players[idx])) return idx
  }
  return fromIndex
}

const isInHand = (p: Player) => !p.hasFolded && p.status === 'connected'
const canAct   = (p: Player) => isInHand(p) && !p.isAllIn

export function computeAnte(state: GameState): number {
  const level = Math.floor(state.handNumber / state.handsPerLevel)
  return state.startingAnte * Math.pow(2, level)
}

export function dealNewHand(state: GameState): GameState {
  const deck = shuffle(freshDeck())
  const handNumber = state.handNumber + 1
  const ante = computeAnte({ ...state, handNumber })

  let players = state.players.map((p) => ({
    ...p,
    hand: [] as Player['hand'],
    hasFolded: p.status !== 'connected' || p.chips <= 0,
    isAllIn: false,
    streetContribution: 0,
    totalContribution: 0,
    hasActed: false,
  }))

  for (const player of players) {
    if (player.hasFolded) continue
    player.hand = [deck.pop()!, deck.pop()!]
  }

  const eligibleCount = players.filter((p) => !p.hasFolded).length
  const dealerButtonIndex = nextActiveIndex(players, state.dealerButtonIndex, (p) => !p.hasFolded)
  const log: ActionLogEntry[] = []

  log.push(logEntry(`Hand #${handNumber} — Ante: $${ante}. ${players[dealerButtonIndex].name} deals.`))

  if (eligibleCount < 2) {
    return {
      ...state,
      players,
      deck,
      communityCards: [],
      street: 'preflop',
      pots: [],
      dealerButtonIndex,
      currentTurnPlayerId: null,
      currentBet: 0,
      minRaise: ante,
      currentAnte: ante,
      handNumber,
      results: null,
      actionLog: [...state.actionLog, ...log, logEntry('Waiting for at least 2 players with chips.')],
    }
  }

  // Everyone posts the ante
  players = players.map((p) => {
    if (p.hasFolded) return p
    const pay = Math.min(ante, p.chips)
    const isAllIn = p.chips - pay === 0
    log.push(logEntry(`${p.name} posts $${pay} ante${isAllIn ? ' (all-in)' : ''}.`))
    return { ...p, chips: p.chips - pay, streetContribution: pay, totalContribution: pay, isAllIn }
  })

  const firstToActIndex = nextActiveIndex(players, dealerButtonIndex, canAct)
  log.push(logEntry(`${players[firstToActIndex].name} is up first.`))

  return {
    ...state,
    players,
    deck,
    communityCards: [],
    street: 'preflop',
    pots: [{
      id: 'main',
      amount: players.reduce((sum, p) => sum + p.streetContribution, 0),
      eligiblePlayerIds: players.filter((p) => !p.hasFolded).map((p) => p.id),
    }],
    dealerButtonIndex,
    currentTurnPlayerId: players[firstToActIndex].id,
    currentBet: 0,
    minRaise: ante,
    currentAnte: ante,
    handNumber,
    results: null,
    actionLog: [...state.actionLog, ...log],
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  const playerIndex = state.players.findIndex((p) => p.id === action.playerId)
  if (playerIndex === -1) return state

  let players = [...state.players]
  const player = players[playerIndex]
  let currentBet = state.currentBet
  let minRaise = state.minRaise
  const log: ActionLogEntry[] = []

  switch (action.type) {
    case 'fold': {
      players[playerIndex] = { ...player, hasFolded: true, hasActed: true }
      log.push(logEntry(`${player.name} folds.`))
      break
    }
    case 'check': {
      players[playerIndex] = { ...player, hasActed: true }
      log.push(logEntry(`${player.name} checks.`))
      break
    }
    case 'call': {
      const owed = currentBet - player.streetContribution
      const pay = Math.max(0, Math.min(owed, player.chips))
      const isAllIn = pay === player.chips && pay < owed
      players[playerIndex] = {
        ...player,
        chips: player.chips - pay,
        streetContribution: player.streetContribution + pay,
        totalContribution: player.totalContribution + pay,
        isAllIn: isAllIn || player.chips - pay === 0,
        hasActed: true,
      }
      log.push(logEntry(pay === 0
        ? `${player.name} checks.`
        : `${player.name} calls $${pay}${isAllIn ? ' (all-in)' : ''}.`))
      break
    }
    case 'raise': {
      const target = Math.min(action.amount ?? currentBet, player.streetContribution + player.chips)
      const pay = target - player.streetContribution
      const raiseIncrement = target - currentBet
      const isFullRaise = raiseIncrement >= minRaise
      const newChips = player.chips - pay

      players[playerIndex] = {
        ...player,
        chips: newChips,
        streetContribution: target,
        totalContribution: player.totalContribution + pay,
        isAllIn: newChips === 0,
        hasActed: true,
      }

      if (target > currentBet) {
        currentBet = target
        if (isFullRaise) minRaise = raiseIncrement
        players = players.map((p, i) => i !== playerIndex && canAct(p) ? { ...p, hasActed: false } : p)
        log.push(logEntry(`${player.name} raises to $${target}${newChips === 0 ? ' (all-in)' : ''}.`))
      } else {
        log.push(logEntry(`${player.name} calls $${pay}${newChips === 0 ? ' (all-in)' : ''}.`))
      }
      break
    }
  }

  return advance({ ...state, players, currentBet, minRaise, actionLog: [...state.actionLog, ...log] })
}

function advance(state: GameState): GameState {
  let s = state
  while (true) {
    const inHand = s.players.filter(isInHand)
    if (inHand.length <= 1) return runShowdown(s)

    const contenders = s.players.filter(canAct)
    const roundComplete =
      contenders.length < 2 ||
      contenders.every((p) => p.hasActed && p.streetContribution === s.currentBet)

    if (!roundComplete) {
      const currentIndex = s.players.findIndex((p) => p.id === s.currentTurnPlayerId)
      const nextIndex = nextActiveIndex(s.players, currentIndex, canAct)
      return {
        ...s,
        currentTurnPlayerId: s.players[nextIndex].id,
        actionLog: [...s.actionLog, logEntry(`${s.players[nextIndex].name} is up next.`)],
      }
    }

    if (s.street === 'river') return runShowdown(s)
    s = moveToNextStreet(s)
  }
}

function moveToNextStreet(state: GameState): GameState {
  const order: Street[] = ['preflop', 'flop', 'turn', 'river']
  const nextStreet = order[order.indexOf(state.street) + 1]

  const deck = [...state.deck]
  const communityCards = [...state.communityCards]
  const dealtCount = nextStreet === 'flop' ? 3 : 1
  const newCards = Array.from({ length: dealtCount }, () => deck.pop()!)
  communityCards.push(...newCards)

  const pots = collectIntoPots(state.players)
  const players = state.players.map((p) => ({ ...p, streetContribution: 0, hasActed: false }))
  const firstToActIndex = nextActiveIndex(players, state.dealerButtonIndex, canAct)
  const contenderCount = players.filter(canAct).length

  const log: ActionLogEntry[] = [logEntry(`${capitalize(nextStreet)}: ${newCards.map(cardLabel).join(' ')}`)]
  if (contenderCount >= 2) log.push(logEntry(`${players[firstToActIndex].name} is up next.`))

  return {
    ...state,
    players,
    deck,
    communityCards,
    street: nextStreet,
    pots,
    currentBet: 0,
    minRaise: state.currentAnte,
    currentTurnPlayerId: contenderCount >= 2 ? players[firstToActIndex].id : null,
    actionLog: [...state.actionLog, ...log],
  }
}

export function runShowdown(state: GameState): GameState {
  let deck = [...state.deck]
  let communityCards = [...state.communityCards]
  const log: ActionLogEntry[] = []

  while (communityCards.length < 5) communityCards.push(deck.pop()!)
  if (communityCards.length !== state.communityCards.length) {
    log.push(logEntry(`Board: ${communityCards.map(cardLabel).join(' ')}`))
  }

  const pots = collectIntoPots(state.players)
  const evaluations = new Map(
    state.players
      .filter((p) => !p.hasFolded)
      .map((p) => [p.id, evaluateHand([...p.hand, ...communityCards])] as const),
  )

  let players = [...state.players]
  const results: ShowdownResult[] = []

  for (const pot of pots) {
    const eligible = pot.eligiblePlayerIds.filter((id) => evaluations.has(id))
    if (eligible.length === 0) continue

    let best = evaluations.get(eligible[0])!
    for (const id of eligible) {
      const ev = evaluations.get(id)!
      if (compareHands(ev, best) > 0) best = ev
    }

    const winnerIds = eligible.filter((id) => compareHands(evaluations.get(id)!, best) === 0)
    const share = Math.floor(pot.amount / winnerIds.length)
    let remainder = pot.amount - share * winnerIds.length

    const winners = winnerIds.map((id) => {
      const amount = share + (remainder > 0 ? 1 : 0)
      if (remainder > 0) remainder--
      players = players.map((p) => p.id === id ? { ...p, chips: p.chips + amount } : p)
      return { playerId: id, amount, handDescription: describeHand(evaluations.get(id)!) }
    })

    const runnerUpId = eligible.find((id) => !winnerIds.includes(id))
    const runnerUp = runnerUpId ? evaluations.get(runnerUpId)! : null
    const tiebreakNote = runnerUp && runnerUp.categoryIndex === best.categoryIndex
      ? tiebreakDescription(best, runnerUp)
      : null

    results.push({ potId: pot.id, winners, tiebreakNote })

    for (const winner of winners) {
      const name = players.find((p) => p.id === winner.playerId)?.name
      log.push(logEntry(`${name} wins $${winner.amount} (${winner.handDescription}).`))
    }
  }

  players = players.map((p) => ({ ...p, totalContribution: 0, streetContribution: 0 }))

  return {
    ...state,
    players,
    deck,
    communityCards,
    street: 'showdown',
    pots,
    currentTurnPlayerId: null,
    results,
    actionLog: [...state.actionLog, ...log],
  }
}

export function collectIntoPots(players: Player[]): Pot[] {
  const contributions = players
    .filter((p) => p.totalContribution > 0)
    .map((p) => ({ id: p.id, amount: p.totalContribution, folded: p.hasFolded }))

  const levels = [...new Set(contributions.map((c) => c.amount))].sort((a, b) => a - b)

  const pots: Pot[] = []
  let prevLevel = 0
  for (const level of levels) {
    const layerAmount = contributions.reduce(
      (sum, c) => sum + (Math.min(c.amount, level) - Math.min(c.amount, prevLevel)),
      0,
    )
    const eligiblePlayerIds = contributions
      .filter((c) => !c.folded && c.amount >= level)
      .map((c) => c.id)
    if (layerAmount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({ id: `pot-${pots.length}`, amount: layerAmount, eligiblePlayerIds })
    }
    prevLevel = level
  }

  return pots
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function cardLabel(card: { rank: string; suit: string }): string {
  const sym = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[card.suit as 'spades' | 'hearts' | 'diamonds' | 'clubs']
  return `${card.rank}${sym}`
}
