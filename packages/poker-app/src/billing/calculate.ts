import type { MoneyMode, Bill, PlayerBill, Debt } from './types'

interface PlayerSnapshot {
  id: string
  name: string
  chips: number
}

export function calculateBill(
  players: PlayerSnapshot[],
  startingChips: number,
  moneyMode: MoneyMode,
): Bill {
  const chipRate = moneyMode.buyIn / startingChips

  const playerBills: PlayerBill[] = players.map((p) => {
    const deltaChips = p.chips - startingChips
    return {
      playerId: p.id,
      name: p.name,
      startChips: startingChips,
      endChips: p.chips,
      deltaChips,
      deltaAmount: Math.round(deltaChips * chipRate * 100) / 100,
    }
  })

  // Minimum transactions: greedily match largest debtor to largest creditor
  const debtors  = playerBills.filter((p) => p.deltaAmount < 0).map((p) => ({ name: p.name, amount: -p.deltaAmount }))
  const creditors = playerBills.filter((p) => p.deltaAmount > 0).map((p) => ({ name: p.name, amount: p.deltaAmount }))
  debtors.sort((a, b) => b.amount - a.amount)
  creditors.sort((a, b) => b.amount - a.amount)

  const debts: Debt[] = []
  let i = 0, j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.round(Math.min(debtors[i].amount, creditors[j].amount) * 100) / 100
    if (amount >= 0.01) {
      debts.push({ from: debtors[i].name, to: creditors[j].name, amount })
    }
    debtors[i].amount  = Math.round((debtors[i].amount  - amount) * 100) / 100
    creditors[j].amount = Math.round((creditors[j].amount - amount) * 100) / 100
    if (debtors[i].amount  < 0.01) i++
    if (creditors[j].amount < 0.01) j++
  }

  return {
    currency: moneyMode.currency,
    buyIn: moneyMode.buyIn,
    chipRate,
    startingChips,
    players: playerBills,
    debts,
  }
}

export function calculateAbandonBill(
  abandoningPlayer: PlayerSnapshot,
  allPlayers: PlayerSnapshot[],
  startingChips: number,
  moneyMode: MoneyMode,
): { bill: Bill; myBill: PlayerBill } {
  const bill = calculateBill(allPlayers, startingChips, moneyMode)
  const myBill = bill.players.find((p) => p.playerId === abandoningPlayer.id)!
  return { bill, myBill }
}
