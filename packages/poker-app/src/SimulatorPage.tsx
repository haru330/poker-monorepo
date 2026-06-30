import { useState, useRef, useEffect } from 'react'
import { dealNewHand, applyAction, runShowdown, evaluateHand, describeHand } from 'poker-engine'
import type { GameState, Action, EquityResult } from 'poker-engine'
import { calculateBill, calculateAbandonBill } from './billing/calculate'
import { BillDialog } from './billing/BillDialog'
import { AbandonDialog } from './billing/AbandonDialog'
import type { Bill, PlayerBill } from './billing/types'

const isInHand = (p: { hasFolded: boolean; status: string }) => !p.hasFolded && p.status === 'connected'

const SUIT_SYM: Record<string, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
const SUIT_COLOR: Record<string, string> = { spades: '#f1f5f9', clubs: '#f1f5f9', hearts: '#f87171', diamonds: '#f87171' }
const cardLabel = (c: { rank: string; suit: string }) => `${c.rank}${SUIT_SYM[c.suit]}`

const PLAYER_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']
const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7']

function playerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length]
}

function findEquity(list: EquityResult[], playerId: string): EquityResult | null {
  return list.find(e => e.playerId === playerId) ?? null
}

function makeInitialState(): GameState {
  return {
    roomCode: 'SIM',
    players: PLAYER_NAMES.map((name, i) => ({
      id: `p${i}`, name, chips: 100, hand: [],
      status: 'connected', hasFolded: false, isAllIn: false, isHost: i === 0,
      streetContribution: 0, totalContribution: 0, hasActed: false,
    })),
    deck: [], communityCards: [], street: 'preflop', pots: [],
    dealerButtonIndex: -1, currentTurnPlayerId: null,
    currentBet: 0, minRaise: 2, startingChips: 100,
    currentAnte: 2, startingAnte: 2, handsPerLevel: 5, handNumber: 0,
    actionLog: [], results: null, equity: null, lastAllInCallerId: null, preflopAction: {},
  }
}

export function SimulatorPage({
  onBack, myPlayerId, externalState, onAction, onNextHand, onRevealCard, onStartGame, onAbandon, moneyMode,
}: {
  onBack: () => void
  myPlayerId?: string
  externalState?: GameState
  onAction?: (action: Action) => void
  onNextHand?: () => void
  onRevealCard?: () => void
  onStartGame?: () => void
  onAbandon?: () => void
  moneyMode?: import('./billing/types').MoneyMode
}) {
  const isMultiplayer = !!externalState
  const [internalState, setInternalState] = useState<GameState | null>(null)
  const state = externalState ?? internalState
  const [isCalculating, setIsCalculating] = useState(!isMultiplayer)
  const [raiseInput, setRaiseInput] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [handsPerLevel, setHandsPerLevel] = useState(5)
  const [showBill, setShowBill] = useState(false)
  const [abandonPending, setAbandonPending] = useState(false)

  // Compute first hand asynchronously so the loading screen renders first (standalone only)
  useEffect(() => {
    if (isMultiplayer) return
    const id = setTimeout(() => {
      setInternalState(dealNewHand(makeInitialState()))
      setIsCalculating(false)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Clear loading overlay when multiplayer state arrives
  useEffect(() => {
    if (externalState) setIsCalculating(false)
  }, [externalState])

  // All-in runout reveal: track how many community cards are shown
  const [localRevealedCount, setLocalRevealedCount] = useState(0)
  const prevStreetRef = useRef<string>('preflop')
  const prevCommunityCountRef = useRef<number>(0)

  // Standalone: detect showdown transition and start from cards already on board
  useEffect(() => {
    if (!state || isMultiplayer) return
    if (state.street === 'showdown' && prevStreetRef.current !== 'showdown') {
      setLocalRevealedCount(prevCommunityCountRef.current)
    }
    prevStreetRef.current = state.street
    if (state.street !== 'showdown') {
      prevCommunityCountRef.current = state.communityCards.length
    }
  }, [state?.street, state?.communityCards.length])

  const isMyTurn = !myPlayerId || state?.currentTurnPlayerId === myPlayerId

  if (!state) return (
    <div style={{ minHeight: '100dvh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CalcOverlay />
    </div>
  )

  // Spectators are observers only — exclude from all game display and logic
  const gamePlayers = state.players.filter((p) => !p.isSpectator)
  const amHost = !isMultiplayer || !!state.players.find((p) => p.id === myPlayerId)?.isHost

  const currentPlayer = gamePlayers.find((p) => p.id === state.currentTurnPlayerId) ?? null
  const totalPot = state.pots.reduce((s, p) => s + p.amount, 0)
  const isShowdown = state.street === 'showdown'
  const isWaiting = state.currentTurnPlayerId === null && !isShowdown

  // In multiplayer use the host-managed count from state; standalone uses local
  const revealedCount = isMultiplayer
    ? (externalState?.allInRevealCount ?? (isShowdown ? state.communityCards.length : 0))
    : localRevealedCount
  const gameOver = (isShowdown || isWaiting) && gamePlayers.filter((p) => p.chips > 0).length <= 1
  const disconnectedWithChips = gamePlayers.filter((p) => p.status === 'disconnected' && p.chips > 0)

  // All-in runout: how many community cards to show (controlled reveal)
  const isAllInRunout = isShowdown && state.communityCards.length === 5 && revealedCount < 5
  const visibleCommunityCards = isShowdown
    ? state.communityCards.slice(0, revealedCount)
    : state.communityCards

  // Equity stage selection — O(1) lookup into pre-computed data
  const effectiveCardCount = isShowdown ? revealedCount : state.communityCards.length
  const spectatorEquity: EquityResult[] | null = (() => {
    const eq = state.equity?.spectator
    if (!eq || effectiveCardCount < 3) return null
    if (effectiveCardCount < 4) return eq.flop
    if (effectiveCardCount < 5) return eq.turn
    return eq.river
  })()
  const rangeEquity: EquityResult[] | null = (() => {
    const eq = state.equity?.range
    if (!eq) return null
    if (state.street === 'preflop') return eq.preflop ?? null
    if (effectiveCardCount < 3) return null
    if (effectiveCardCount < 4) return eq.flop
    if (effectiveCardCount < 5) return eq.turn
    return eq.river
  })()

  // Who controls the all-in reveal button
  const allInController = gamePlayers.find(p => p.id === state.lastAllInCallerId)
    ?? gamePlayers.find(p => p.isAllIn)

  function act(type: Action['type'], amount?: number) {
    if (!currentPlayer) return
    setRaiseInput('')
    if (onAction) {
      onAction({ playerId: currentPlayer.id, type, amount })
    } else {
      const pid = currentPlayer.id
      setInternalState((s) => s ? applyAction(s, { playerId: pid, type, amount }) : s)
    }
  }

  function disconnect(playerId: string) {
    setInternalState((s) => {
      if (!s) return s
      const player = s.players.find((p) => p.id === playerId)
      if (!player || player.status === 'disconnected') return s

      if (s.currentTurnPlayerId === playerId && !player.hasFolded) {
        const folded = applyAction(s, { playerId, type: 'fold' })
        return { ...folded, players: folded.players.map((p) => p.id === playerId ? { ...p, status: 'disconnected' } : p) }
      }

      let next: GameState = {
        ...s,
        players: s.players.map((p) =>
          p.id === playerId ? { ...p, status: 'disconnected', hasFolded: true, hasActed: true } : p
        ),
      }

      const stillIn = next.players.filter(isInHand)
      if (stillIn.length <= 1 && next.street !== 'showdown') {
        next = runShowdown(next)
      }

      return next
    })
  }

  function reconnect(playerId: string) {
    setInternalState((s) => s ? {
      ...s,
      players: s.players.map((p) =>
        p.id === playerId ? { ...p, status: 'connected' } : p
      ),
    } : s)
  }

  function nextHand() {
    if (onNextHand) {
      setIsCalculating(true)
      onNextHand()
      return
    }
    setIsCalculating(true)
    setRaiseInput('')
    setLocalRevealedCount(0)
    prevCommunityCountRef.current = 0
    setTimeout(() => {
      setInternalState((s) => dealNewHand({ ...(s ?? makeInitialState()), handsPerLevel }))
      setIsCalculating(false)
    }, 0)
  }

  function restart() {
    setRaiseInput('')
    setLocalRevealedCount(0)
    prevCommunityCountRef.current = 0
    if (onStartGame) {
      setIsCalculating(true)
      onStartGame()
      return
    }
    setIsCalculating(true)
    setTimeout(() => {
      setInternalState(dealNewHand(makeInitialState()))
      setIsCalculating(false)
    }, 0)
  }

  function setChips(playerId: string, amount: number) {
    setInternalState((s) => s ? {
      ...s,
      players: s.players.map((p) => p.id === playerId ? { ...p, chips: amount } : p),
    } : s)
  }

  const owed = currentPlayer ? state.currentBet - currentPlayer.streetContribution : 0
  const canCheck = owed <= 0
  const minRaiseTarget = state.currentBet + state.minRaise
  const maxRaise = currentPlayer ? currentPlayer.streetContribution + currentPlayer.chips : 0
  const raiseAmt = parseInt(raiseInput)
  const raiseValid = !isNaN(raiseAmt) && raiseAmt > state.currentBet && raiseAmt <= maxRaise

  // Level display
  const level = Math.floor(state.handNumber / handsPerLevel) + 1

  return (
    <div style={{ minHeight: '100dvh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif', padding: 16, boxSizing: 'border-box', position: 'relative' }}>

      {/* Calculation overlay — blocks all input while equity is precomputing */}
      {isCalculating && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(15,23,42,0.82)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CalcOverlay />
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <button onClick={onBack} style={btnStyle('ghost')}>← Back</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>Hand #{state.handNumber} · Level {level} · Ante ${state.currentAnte}</div>
          {isMultiplayer && state.roomCode && (
            <div style={{ fontSize: 11, color: '#475569', letterSpacing: 2 }}>#{state.roomCode}</div>
          )}
          {moneyMode && <div style={{ fontSize: 11, color: '#f59e0b' }}>💰 {moneyMode.buyIn} {moneyMode.currency}/player</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isMultiplayer && <button onClick={() => setAbandonPending(true)} style={{ ...btnStyle('ghost'), fontSize: 11, color: '#f87171' }}>Abandon</button>}
          {!isMultiplayer && <button onClick={restart} style={btnStyle('ghost')}>Restart</button>}
        </div>
      </div>

      {/* Hands per level setting — standalone only */}
      {!isMultiplayer && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>Hands/level:</span>
          {[3, 5, 10].map((n) => (
            <button key={n} onClick={() => setHandsPerLevel(n)} style={{ ...btnStyle('ghost'), padding: '2px 10px', fontSize: 12, opacity: handsPerLevel === n ? 1 : 0.4 }}>{n}</button>
          ))}
        </div>
      )}

      {/* Community cards */}
      <div style={{ background: '#166534', borderRadius: 12, padding: '12px 16px', marginBottom: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: '#86efac', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 2 }}>
          {state.street} · Pot: <span data-testid="pot-total">${totalPot}</span>
          {state.pots.length > 1 && (
            <span style={{ color: '#fbbf24' }}> ({state.pots.map((p, i) => `${i === 0 ? 'Main' : `Side${i}`}:$${p.amount}`).join(' ')})</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', minHeight: 56 }}>
          {visibleCommunityCards.length === 0
            ? <span style={{ color: '#4ade80', opacity: 0.4, fontSize: 13, alignSelf: 'center' }}>No cards yet</span>
            : visibleCommunityCards.map((c, i) => <CardChip key={i} rank={c.rank} suit={c.suit} />)
          }
          {/* Hidden card slots during all-in runout */}
          {isAllInRunout && Array.from({ length: 5 - revealedCount }).map((_, i) => (
            <div key={`hidden-${i}`} style={{
              width: 44, height: 60, borderRadius: 6,
              background: '#0f172a', border: '2px dashed #334155',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#334155', fontSize: 20,
            }}>?</div>
          ))}
        </div>
      </div>

      {/* Players */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {gamePlayers.map((p, playerIdx) => {
          const isTurn = p.id === state.currentTurnPlayerId
          const isOut = p.chips === 0 && !isTurn
          const handEval = !p.hasFolded && p.hand.length > 0
            ? evaluateHand([...p.hand, ...visibleCommunityCards])
            : null
          const handName = handEval ? describeHand(handEval) : null
          return (
            <div key={p.id} data-testid={`player-row-${p.name.toLowerCase()}`} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: isTurn ? '#1e3a5f' : '#1e293b',
              border: `1px solid ${isTurn ? '#3b82f6' : '#334155'}`,
              borderRadius: 10, padding: '8px 12px',
              opacity: p.hasFolded || isOut ? 0.45 : 1,
            }}>
              {/* Name + chips */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: isTurn ? 'bold' : 'normal', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {isTurn && '▶ '}{p.name}
                  {p.status === 'disconnected' && <span style={{ color: '#f59e0b', fontSize: 11 }}> disconnected</span>}
                  {p.status === 'connected' && p.hasFolded && p.chips > 0 && <span style={{ color: '#ef4444', fontSize: 11 }}>folded</span>}
                  {p.isAllIn && <span style={{ color: '#fbbf24', fontSize: 11 }}>all-in</span>}
                  {p.chips === 0 && !p.isAllIn && <span style={{ color: '#64748b', fontSize: 11 }}>bust</span>}
                  {handName && (
                    <span style={{ fontSize: 11, background: '#0f172a', border: '1px solid #334155', borderRadius: 4, padding: '1px 6px', color: '#a5b4fc' }}>
                      {handName}
                      {(!isMultiplayer || state.players.find(q => q.id === myPlayerId)?.isSpectator) && (() => {
                        const re = rangeEquity ? findEquity(rangeEquity, p.id) : null
                        if (!re) return null
                        if (state.street === 'preflop') {
                          return (
                            <span style={{ marginLeft: 5, color: '#94a3b8', fontWeight: 'bold' }}>
                              ↠ {Math.round(re.win * 100)}%
                            </span>
                          )
                        }
                        const tier = state.preflopAction[p.id]
                        const tierLabel = tier === 'raise' ? 'R' : tier === 'call' ? 'C' : tier === 'check' ? 'K' : '?'
                        const tierColor = tier === 'raise' ? '#f87171' : tier === 'call' ? '#fbbf24' : tier === 'check' ? '#94a3b8' : '#475569'
                        return (
                          <span style={{ marginLeft: 5, color: '#22d3ee', fontWeight: 'bold' }}>
                            ↠ {Math.round(re.win * 100)}%
                            <span style={{ marginLeft: 3, fontSize: 9, color: tierColor, fontWeight: 'bold', opacity: 0.85 }}>[{tierLabel}]</span>
                          </span>
                        )
                      })()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  chips: <span data-testid="player-chips" data-player={p.name.toLowerCase()} style={{ color: '#94a3b8' }}>${p.chips}</span>
                  {p.streetContribution > 0 && <span style={{ color: '#60a5fa' }}> · bet: ${p.streetContribution}</span>}
                </div>
                {/* Equity bar — spectator/standalone see exact odds; players see own range equity */}
                {(() => {
                  const amSpectator = !!state.players.find(q => q.id === myPlayerId)?.isSpectator
                  let winPct: number, tiePct: number, label: string
                  const color = playerColor(playerIdx)
                  if (!isMultiplayer || amSpectator) {
                    const se = spectatorEquity ? findEquity(spectatorEquity, p.id) : null
                    if (se) {
                      winPct = se.win * 100; tiePct = se.tie * 100
                      label = `${Math.round(winPct)}%${tiePct > 0.5 ? ` (+${Math.round(tiePct)}% tie)` : ''}`
                    } else {
                      // Preflop: no exact equity yet — use range equity vs random
                      const re = rangeEquity ? findEquity(rangeEquity, p.id) : null
                      if (!re) return null
                      winPct = re.win * 100; tiePct = re.tie * 100
                      label = `${Math.round(winPct)}%${tiePct > 0.5 ? ` (+${Math.round(tiePct)}% tie)` : ''}`
                    }
                  } else if (p.id === myPlayerId) {
                    const re = rangeEquity ? findEquity(rangeEquity, p.id) : null
                    if (!re) return null
                    winPct = re.win * 100; tiePct = re.tie * 100
                    const tier = state.preflopAction[p.id]
                    const tierLabel = state.street !== 'preflop'
                      ? ` [${tier === 'raise' ? 'R' : tier === 'call' ? 'C' : tier === 'check' ? 'K' : '?'}]`
                      : ''
                    label = `${Math.round(winPct)}%${tiePct > 0.5 ? ` (+${Math.round(tiePct)}% tie)` : ''}${tierLabel}`
                  } else {
                    return null
                  }
                  return (
                    <div style={{ marginTop: 4, position: 'relative', height: 14, background: '#0f172a', borderRadius: 7, overflow: 'hidden' }}>
                      <div style={{
                        position: 'absolute', left: 0, top: 0, height: '100%',
                        width: `${winPct}%`, background: color,
                        transition: 'width 0.6s ease', opacity: p.hasFolded ? 0.3 : 1,
                      }} />
                      <div style={{
                        position: 'absolute', left: `${winPct}%`, top: 0, height: '100%',
                        width: `${tiePct}%`,
                        background: `repeating-linear-gradient(45deg, ${color}55 0px, ${color}55 4px, transparent 4px, transparent 8px)`,
                        transition: 'width 0.6s ease, left 0.6s ease',
                      }} />
                      <div style={{
                        position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 'bold', color: '#f1f5f9',
                        textShadow: '0 1px 2px #000',
                      }}>
                        {label}
                      </div>
                    </div>
                  )
                })()}
              </div>
              {/* Cards — spectators see all; players see only own cards in multiplayer */}
              <div style={{ display: 'flex', gap: 4 }}>
                {p.hand.length === 0
                  ? <span style={{ fontSize: 11, color: '#475569' }}>—</span>
                  : (!myPlayerId || p.id === myPlayerId || state.players.find(q => q.id === myPlayerId)?.isSpectator)
                    ? p.hand.map((c, i) => <CardChip key={i} rank={c.rank} suit={c.suit} small />)
                    : p.hand.map((_, i) => <CardBack key={i} />)
                }
              </div>
              {/* Disconnect / Reconnect — standalone mode only */}
              {!isMultiplayer && (
                p.status === 'disconnected' && p.chips > 0
                  ? <button onClick={() => reconnect(p.id)} style={{ ...btnStyle('ghost'), fontSize: 11, padding: '2px 8px', color: '#86efac' }}>↩ Reconnect</button>
                  : !isShowdown && !isWaiting && !p.hasFolded && p.chips > 0
                    ? <button onClick={() => disconnect(p.id)} style={{ ...btnStyle('ghost'), fontSize: 11, padding: '2px 8px', color: '#f87171' }}>✕ DC</button>
                    : null
              )}
            </div>
          )
        })}
      </div>

      {/* All-in runout reveal button */}
      {isAllInRunout && allInController && (() => {
        const iAmController = !isMultiplayer || myPlayerId === state.lastAllInCallerId
        if (iAmController) {
          return (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <button
                onClick={() => {
                  if (onRevealCard) onRevealCard()
                  else setLocalRevealedCount((c) => Math.min(c + 1, 5))
                }}
                style={{ ...btnStyle('warning'), fontSize: 16, padding: '10px 24px' }}
              >
                {allInController.name}: Reveal card {revealedCount + 1}/5 ▶
              </button>
            </div>
          )
        }
        return (
          <div style={{ textAlign: 'center', marginBottom: 12, color: '#64748b', fontSize: 14 }}>
            Waiting for {allInController.name} to reveal…
          </div>
        )
      })()}

      {/* Showdown results — only after all community cards are revealed */}
      {isShowdown && state.results && revealedCount >= 5 && (
        <div style={{ background: '#1e293b', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#fbbf24' }}>Showdown</div>
          {state.results.flatMap((r) => r.winners).map((w, i) => {
            const name = state.players.find((p) => p.id === w.playerId)?.name ?? w.playerId
            return (
              <div key={i} style={{ fontSize: 13, color: '#86efac' }}>
                {name} wins ${w.amount} — {w.handDescription}
              </div>
            )
          })}
        </div>
      )}

      {/* Action buttons */}
      {gameOver ? (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div style={{ color: '#fbbf24', fontWeight: 'bold' }}>
            Game over! {gamePlayers.find((p) => p.chips > 0)?.name ?? '—'} wins!
          </div>
          {moneyMode && (
            <button onClick={() => setShowBill(true)} style={{ ...btnStyle('primary'), background: '#f59e0b' }}>
              💰 View Bill
            </button>
          )}
          {amHost && <button onClick={restart} style={btnStyle('primary')}>Play again</button>}
        </div>
      ) : isWaiting ? (
        <div style={{ background: '#1e293b', borderRadius: 10, padding: 12, textAlign: 'center' }}>
          <div style={{ color: '#f59e0b', fontWeight: 'bold', marginBottom: 6 }}>Waiting for players</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            Need at least 2 connected players with chips.
            {disconnectedWithChips.length > 0 && ` Reconnect: ${disconnectedWithChips.map((p) => p.name).join(', ')}`}
          </div>
          {disconnectedWithChips.length > 0 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {disconnectedWithChips.map((p) => (
                <button key={p.id} onClick={() => reconnect(p.id)} style={btnStyle('secondary')}>
                  ↩ Reconnect {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : isShowdown && revealedCount >= 5 ? (
        <div style={{ textAlign: 'center' }}>
          {amHost
            ? <button onClick={nextHand} style={btnStyle('primary')}>Next hand →</button>
            : <p style={{ color: '#64748b', fontSize: 14 }}>Waiting for host to deal next hand…</p>
          }
        </div>
      ) : currentPlayer && !isMyTurn ? (
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 12, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
          {currentPlayer.name}'s turn…
        </div>
      ) : currentPlayer && (
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            <span data-testid="current-player-name">{currentPlayer.name}</span>'s turn · chips: ${currentPlayer.chips}
            {owed > 0 && <span style={{ color: '#60a5fa' }}> · to call: ${Math.min(owed, currentPlayer.chips)}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <button onClick={() => act('fold')} style={btnStyle('danger')}>Fold</button>
            {canCheck
              ? <button onClick={() => act('check')} style={btnStyle('secondary')}>Check</button>
              : <button onClick={() => act('call')} style={btnStyle('secondary')}>Call ${Math.min(owed, currentPlayer.chips)}</button>
            }
            <button onClick={() => act('raise', currentPlayer.streetContribution + currentPlayer.chips)} style={btnStyle('warning')}>
              All-in ${currentPlayer.chips}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number"
              placeholder={`Raise to (>${state.currentBet}, min ${minRaiseTarget} full raise)`}
              value={raiseInput}
              onChange={(e) => setRaiseInput(e.target.value)}
              style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 14 }}
              min={minRaiseTarget}
              max={maxRaise}
            />
            <button onClick={() => act('raise', raiseAmt)} disabled={!raiseValid} style={btnStyle('primary')}>
              Raise
            </button>
          </div>
          {/* Quick raise buttons */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {[minRaiseTarget, Math.floor(maxRaise / 2), Math.floor(maxRaise * 0.75), maxRaise].map((amt) => (
              amt > state.currentBet && amt <= maxRaise ? (
                <button key={amt} onClick={() => act('raise', amt)} style={{ ...btnStyle('ghost'), fontSize: 12, padding: '4px 10px' }}>
                  ${amt}
                </button>
              ) : null
            ))}
          </div>
        </div>
      )}

      {/* Test chip setter — only between hands in standalone mode */}
      {isShowdown && !isMultiplayer && (
        <div style={{ marginTop: 10, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>🔧 Set chips (test)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {gamePlayers.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>{p.name}:</span>
                <input
                  data-testid={`set-chips-${p.name.toLowerCase()}`}
                  type="number"
                  defaultValue={p.chips}
                  min={0}
                  style={{ width: 54, background: '#1e293b', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', color: '#f1f5f9', fontSize: 12 }}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v) && v >= 0) setChips(p.id, v)
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action log */}
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowLog((v) => !v)} style={{ ...btnStyle('ghost'), fontSize: 12 }}>
          {showLog ? 'Hide' : 'Show'} action log ({state.actionLog.length})
        </button>
        {showLog && (
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 10, marginTop: 6, maxHeight: 200, overflowY: 'auto' }}>
            {state.actionLog.slice(-30).map((entry) => (
              <div key={entry.id} style={{ fontSize: 12, color: '#64748b', padding: '1px 0' }}>» {entry.message}</div>
            ))}
          </div>
        )}
      </div>

      {/* Bill dialog — end of game */}
      {showBill && moneyMode && (() => {
        const bill = calculateBill(
          gamePlayers.map((p) => ({ id: p.id, name: p.name, chips: p.chips })),
          state.startingChips,
          moneyMode,
        )
        return <BillDialog bill={bill} onClose={() => setShowBill(false)} />
      })()}

      {/* Abandon dialog — mid-game leave */}
      {abandonPending && moneyMode && (() => {
        const me = gamePlayers.find((p) => p.id === myPlayerId)
        if (!me) return null
        const { bill, myBill } = calculateAbandonBill(
          { id: me.id, name: me.name, chips: me.chips },
          gamePlayers.map((p) => ({ id: p.id, name: p.name, chips: p.chips })),
          state.startingChips,
          moneyMode,
        )
        return (
          <AbandonDialog
            bill={bill}
            myBill={myBill}
            onConfirm={() => { setAbandonPending(false); onAbandon?.() }}
            onCancel={() => setAbandonPending(false)}
          />
        )
      })()}

      {/* Abandon dialog — no money mode, just confirm */}
      {abandonPending && !moneyMode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#1e293b', borderRadius: 14, padding: 24, maxWidth: 320, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, color: '#f87171' }}>Leave game?</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>Your chips will be removed. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setAbandonPending(false); onAbandon?.() }} style={{ flex: 1, background: '#dc2626', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 'bold', cursor: 'pointer', color: '#fff' }}>Leave</button>
              <button onClick={() => setAbandonPending(false)} style={{ flex: 1, background: '#334155', border: 'none', borderRadius: 8, padding: '10px 0', cursor: 'pointer', color: '#fff' }}>Stay</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Calculation overlay ────────────────────────────────────────────────────

function CalcOverlay() {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: 48, height: 48, margin: '0 auto 14px',
        border: '4px solid #1e3a5f', borderTopColor: '#3b82f6',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <div style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: 15 }}>Computing equity…</div>
      <div style={{ color: '#475569', fontSize: 12, marginTop: 4 }}>Simulating 500 runouts per player</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Card chip ──────────────────────────────────────────────────────────────

function CardBack() {
  return (
    <div style={{
      width: 30, height: 42, borderRadius: 6,
      background: 'repeating-linear-gradient(135deg, #1e3a5f 0px, #1e3a5f 4px, #172554 4px, #172554 8px)',
      border: '1px solid #334155', flexShrink: 0,
    }} />
  )
}

function CardChip({ rank, suit, small }: { rank: string; suit: string; small?: boolean }) {
  const color = SUIT_COLOR[suit] ?? '#f1f5f9'
  const size = small ? { width: 30, height: 42, fontSize: 12 } : { width: 44, height: 60, fontSize: 18 }
  return (
    <div style={{
      ...size, background: '#1e293b', border: '1px solid #334155',
      borderRadius: 6, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', color, fontWeight: 'bold',
      boxShadow: '0 2px 6px rgba(0,0,0,0.6)', flexShrink: 0,
    }}>
      <span style={{ lineHeight: 1 }}>{rank}</span>
      <span style={{ lineHeight: 1, fontSize: small ? 10 : 15 }}>{SUIT_SYM[suit]}</span>
    </div>
  )
}

// ── Button styles ──────────────────────────────────────────────────────────

function btnStyle(variant: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost') {
  const base: React.CSSProperties = {
    border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14,
    fontWeight: 'bold', cursor: 'pointer', transition: 'opacity 0.15s',
  }
  const variants: Record<string, React.CSSProperties> = {
    primary:   { background: '#3b82f6', color: '#fff' },
    secondary: { background: '#334155', color: '#f1f5f9' },
    danger:    { background: '#dc2626', color: '#fff' },
    warning:   { background: '#d97706', color: '#fff' },
    ghost:     { background: 'transparent', color: '#94a3b8', border: '1px solid #334155' },
  }
  return { ...base, ...variants[variant] }
}
