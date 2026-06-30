import type { Bill, PlayerBill } from './types'

const fmt = (n: number, currency: string) => {
  const abs = Math.abs(n).toFixed(2)
  return `${abs} ${currency}`
}

export function formatEndGameMessage(bill: Bill): string {
  const sorted = [...bill.players].sort((a, b) => b.endChips - a.endChips)
  const lines = [
    `🃏 Poker night ended!`,
    `Rate: ${bill.startingChips} chips = ${bill.buyIn.toFixed(2)} ${bill.currency}`,
    ``,
    `Results:`,
    ...sorted.map((p) => {
      const sign = p.deltaAmount >= 0 ? '+' : ''
      const trophy = p.endChips >= bill.startingChips * 1.5 ? ' 🏆' : p.endChips > bill.startingChips ? ' 📈' : ''
      return `${p.name}: ${p.endChips} chips → ${sign}${fmt(p.deltaAmount, bill.currency)}${trophy}`
    }),
    ``,
    bill.debts.length > 0 ? `Settle up:` : `All square — no debts!`,
    ...bill.debts.map((d) => `${d.from} → ${d.to}: ${fmt(d.amount, bill.currency)}`),
  ]
  return lines.join('\n')
}

export function formatAbandonMessage(bill: Bill, myBill: PlayerBill): string {
  const myDebts = bill.debts.filter((d) => d.from === myBill.name)
  const myWins  = bill.debts.filter((d) => d.to   === myBill.name)
  const lines = [
    `🃏 Left the poker game early.`,
    `${myBill.name}: ${myBill.endChips} / ${myBill.startChips} chips → ${myBill.deltaAmount >= 0 ? '+' : ''}${fmt(myBill.deltaAmount, bill.currency)}`,
    ``,
    ...(myDebts.length > 0
      ? [`You owe:`, ...myDebts.map((d) => `  ${d.to}: ${fmt(d.amount, bill.currency)}`)]
      : myWins.length > 0
      ? [`You are owed:`, ...myWins.map((d) => `  ${d.from}: ${fmt(d.amount, bill.currency)}`)]
      : [`All square — no debts!`]),
  ]
  return lines.join('\n')
}
