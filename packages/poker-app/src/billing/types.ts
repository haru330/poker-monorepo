export interface MoneyMode {
  enabled: boolean
  currency: string
  buyIn: number  // e.g. 5 EUR per player for the whole game
}

export const DEFAULT_MONEY_MODE: MoneyMode = {
  enabled: false,
  currency: 'EUR',
  buyIn: 5,
}

export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD', 'AUD', 'CAD',
  'CHF', 'CNY', 'KRW', 'BHD', 'KWD', 'JOD', 'AED',
]

export interface PlayerBill {
  playerId: string
  name: string
  startChips: number
  endChips: number
  deltaChips: number
  deltaAmount: number  // positive = won, negative = owed
}

export interface Debt {
  from: string  // name of player who owes
  to: string    // name of player who is owed
  amount: number
}

export interface Bill {
  currency: string
  buyIn: number
  chipRate: number  // EUR per chip
  startingChips: number
  players: PlayerBill[]
  debts: Debt[]
}
