import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { TransportProvider, useTransport } from './transport/TransportProvider'
import { QRDisplay } from './qr/QRDisplay'
import { QRScanner } from './qr/QRScanner'
import { getDevLogs, clearDevLogs, subscribeDevLogs, type LogEntry } from './devLog'
import { SimulatorPage } from './SimulatorPage'
import { type MoneyMode, DEFAULT_MONEY_MODE, CURRENCIES } from './billing/types'

export default function App() {
  const [sim, setSim] = useState(false)
  if (sim) return <SimulatorPage onBack={() => setSim(false)} />
  return (
    <TransportProvider>
      <Screen onOpenSim={() => setSim(true)} />
    </TransportProvider>
  )
}

function Screen({ onOpenSim }: { onOpenSim: () => void }) {
  const {
    transport, gameState, myPlayerId, pairing, qrPayload, error, lastPing,
    hostOnline, hostOffline, joinFromQR,
    scanNextGuest, onAnswerScanned, abandon, leave,
  } = useTransport()

  const [view, setView] = useState<'home' | 'host-name' | 'host' | 'join' | 'scan-answer'>('home')
  const [name, setName] = useState(() => localStorage.getItem('poker-username') ?? '')
  const [manualInput, setManualInput] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [moneyMode, setMoneyMode] = useState<MoneyMode>(DEFAULT_MONEY_MODE)

  function handleLeave() { leave(); setView('home'); setManualInput(''); setShowManual(false) }

  const isOnlineHost = transport?.role === 'host' && qrPayload && pairing.step === 'idle'
  const isOfflineHost = transport?.role === 'host' && 'offerNext' in transport

  // ── Error ───────────────────────────────────────────────────────────────
  if (error) return (
    <Layout>
      <CommitBadge />
      <h2 style={{ color: '#f87171', margin: 0 }}>{error === 'Host left the game' ? 'Game ended' : 'Error'}</h2>
      <p style={{ opacity: 0.6, margin: 0 }}>{error}</p>
      <button onClick={handleLeave}>Back to home</button>
      <DevLogPanel />
    </Layout>
  )

  // ── Home ─────────────────────────────────────────────────────────────────
  if (view === 'home') return (
    <Layout>
      <CommitBadge />
      <h2 style={{ margin: 0 }}>Poker Dev</h2>
      <Row>
        <button onClick={() => setView('host-name')}>Host</button>
        <button onClick={() => setView('join')}>Join (scan QR)</button>
      </Row>
      <button onClick={onOpenSim} style={{ background: '#166534', border: 'none', borderRadius: 8, padding: '8px 20px', color: '#86efac', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
        🃏 Poker Simulator
      </button>
      <DevLogPanel />
    </Layout>
  )

  // ── Host: enter name ─────────────────────────────────────────────────────
  if (view === 'host-name') return (
    <Layout>
      <CommitBadge />
      <h2 style={{ margin: 0 }}>Your name</h2>
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Row>
        <button
          disabled={!name.trim()}
          onClick={() => { hostOnline(name.trim()); setView('host') }}
        >
          Online (QR)
        </button>
        <button
          disabled={!name.trim()}
          onClick={() => { hostOffline(name.trim()); setView('host') }}
        >
          Offline (QR)
        </button>
      </Row>
      <button onClick={() => setView('home')}>Back</button>
      <DevLogPanel />
    </Layout>
  )

  // ── Join: scan QR or paste manually ─────────────────────────────────────
  if (view === 'join' && !transport) return (
    <Layout>
      <CommitBadge />
      <h2 style={{ margin: 0 }}>Join game</h2>
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {name.trim() && (
        <>
          <QRScanner onScan={(raw) => joinFromQR(raw, name.trim())} />
          <p style={{ opacity: 0.4, fontSize: 13, margin: 0 }}>— or enter room code (online) —</p>
          <Row>
            <input
              placeholder="ABCD"
              maxLength={4}
              style={{ width: 80, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 4 }}
              onChange={(e) => {
                const v = e.target.value.toUpperCase()
                if (v.length === 4) joinFromQR(JSON.stringify({ mode: 'supabase', roomCode: v }), name.trim())
              }}
            />
          </Row>
          <button style={{ opacity: 0.5, fontSize: 12 }} onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'Hide' : 'Can\'t scan? Paste QR text'}
          </button>
          {showManual && (
            <div style={{ width: '100%', maxWidth: 320 }}>
              <textarea
                rows={4}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 11, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: 8, boxSizing: 'border-box' }}
                placeholder='Paste QR JSON here e.g. {"mode":"rtc","offer":"...","slot":0}'
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
              />
              <button
                disabled={!manualInput.trim()}
                style={{ width: '100%', marginTop: 6 }}
                onClick={() => joinFromQR(manualInput.trim(), name.trim())}
              >
                Connect with pasted text
              </button>
            </div>
          )}
        </>
      )}
      <button onClick={() => setView('home')}>Back</button>
      <DevLogPanel />
    </Layout>
  )

  // ── Guest: show answer QR for host to scan (offline) ────────────────────
  if (pairing.step === 'guest-answering' && qrPayload && !gameState) return (
    <Layout>
      <CommitBadge />
      <h2 style={{ margin: 0 }}>Show this to the host</h2>
      <QRDisplay value={qrPayload} label="Host scans your screen" />
      <ManualFallback value={qrPayload} />
      <p style={{ opacity: 0.6, fontSize: 13, margin: 0 }}>Hold still — host is scanning your answer</p>
      <button onClick={handleLeave}>Leave</button>
      <DevLogPanel />
    </Layout>
  )

  // ── Host offline: show offer QR ──────────────────────────────────────────
  if (pairing.step === 'host-offering' && qrPayload) return (
    <Layout>
      <CommitBadge />
      <h2 style={{ margin: 0 }}>Let players scan</h2>
      <QRDisplay value={qrPayload} label={`Guest ${(pairing as { slot: number }).slot + 1} — scan to join`} />
      <ManualFallback value={qrPayload} />
      {gameState && gameState.players.length > 0 && (
        <p style={{ opacity: 0.5, fontSize: 13, margin: 0 }}>
          Players: {gameState.players.map((p) => p.name).join(', ')}
        </p>
      )}
      <Row>
        {gameState && gameState.players.filter((p) => !p.isSpectator).length >= 2 && (
          <button onClick={() => transport?.startGame()}>Start Game</button>
        )}
        <button onClick={scanNextGuest}>Scan guest's answer →</button>
        <button onClick={handleLeave}>Cancel</button>
      </Row>
      <DevLogPanel />
    </Layout>
  )

  // ── Host: scanning guest's answer QR ────────────────────────────────────
  if (pairing.step === 'host-scanning') return (
    <Layout>
      <CommitBadge />
      <h2 style={{ margin: 0 }}>Scan guest's screen</h2>
      <QRScanner onScan={(raw) => { onAnswerScanned(raw); setView('host') }} />
      <button style={{ opacity: 0.5, fontSize: 12 }} onClick={() => setShowManual((v) => !v)}>
        {showManual ? 'Hide' : 'Can\'t scan? Paste guest\'s QR text'}
      </button>
      {showManual && (
        <div style={{ width: '100%', maxWidth: 320 }}>
          <textarea
            rows={4}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 11, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: 8, boxSizing: 'border-box' }}
            placeholder='Paste guest answer JSON here'
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
          />
          <button
            disabled={!manualInput.trim()}
            style={{ width: '100%', marginTop: 6 }}
            onClick={() => { onAnswerScanned(manualInput.trim()); setView('host') }}
          >
            Connect with pasted text
          </button>
        </div>
      )}
      <button onClick={handleLeave}>Leave</button>
      <DevLogPanel />
    </Layout>
  )

  // ── Host waiting for PeerJS broker ───────────────────────────────────────
  if (view === 'host' && pairing.step === 'idle' && !qrPayload && !gameState) return (
    <Layout>
      <CommitBadge />
      <p style={{ opacity: 0.5 }}>Connecting to PeerJS broker…</p>
      <button onClick={handleLeave}>Cancel</button>
      <DevLogPanel />
    </Layout>
  )

  // ── Game started: hand has been dealt — show the poker table ────────────
  if (gameState && gameState.handNumber > 0) {
    return (
      <SimulatorPage
        myPlayerId={myPlayerId ?? undefined}
        externalState={gameState}
        onAction={(action) => transport?.sendAction(action)}
        onNextHand={() => transport?.nextHand()}
        onRevealCard={() => transport?.revealCard()}
        onStartGame={() => { setMoneyMode(DEFAULT_MONEY_MODE); transport?.startGame() }}
        onAbandon={() => { abandon(); handleLeave() }}
        moneyMode={moneyMode.enabled ? moneyMode : undefined}
        onBack={handleLeave}
      />
    )
  }

  // ── Dev lobby / in-game: ping button for all players ────────────────────
  if (gameState) {
    const myName = localStorage.getItem('poker-username') ?? name

    return (
      <Layout>
        <CommitBadge />
        <h2 style={{ margin: 0 }}>Dev Lobby</h2>
        <p style={{ opacity: 0.5, fontSize: 13, margin: 0 }}>
          Room: {gameState.roomCode} — {gameState.players.length} player(s)
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, width: '100%', maxWidth: 320 }}>
          {gameState.players.map((p) => (
            <li key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', fontSize: 14, opacity: p.status === 'connected' ? 1 : 0.4 }}>
              <span>
                {p.isHost ? '👑 ' : '• '}{p.name}
                {p.status === 'disconnected' && ' (off)'}
                {p.isSpectator && <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8', background: '#1e293b', border: '1px solid #334155', borderRadius: 4, padding: '1px 6px' }}>spectator</span>}
              </span>
              {p.id === myPlayerId && (
                <button
                  onClick={() => transport?.toggleSpectator()}
                  style={{ fontSize: 11, padding: '2px 10px', borderRadius: 6, border: '1px solid #334155', background: p.isSpectator ? '#334155' : 'transparent', color: p.isSpectator ? '#f1f5f9' : '#64748b', cursor: 'pointer' }}
                >
                  {p.isSpectator ? 'Join game' : 'Spectate'}
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          style={{ padding: '14px 32px', fontSize: 18, background: '#6366f1', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer' }}
          onClick={() => transport?.devPing(myName)}
        >
          Ping!
        </button>

        {lastPing && (
          <p style={{ fontSize: 14, color: '#86efac', margin: 0 }}>
            Last ping: <strong>{lastPing}</strong>
          </p>
        )}

        {/* Online host: show QR + room code */}
        {isOnlineHost && qrPayload && (
          <>
            <p style={{ fontSize: 24, fontWeight: 'bold', letterSpacing: 6, margin: 0 }}>{gameState.roomCode}</p>
            <QRDisplay value={qrPayload} label="Scan to join" />
          </>
        )}

        {/* Offline host controls */}
        {isOfflineHost && (
          <button onClick={() => (transport as { offerNext(): void }).offerNext()}>
            Add player (QR)
          </button>
        )}

        {/* Money mode — host only, locked once game starts */}
        {transport?.role === 'host' && (
          <div style={{ width: '100%', maxWidth: 320, background: '#1e293b', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', fontSize: 14 }}>💰 Money mode</span>
              <button
                onClick={() => setMoneyMode((m) => ({ ...m, enabled: !m.enabled }))}
                style={{ background: moneyMode.enabled ? '#6366f1' : '#334155', border: 'none', borderRadius: 20, padding: '4px 14px', color: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                {moneyMode.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {moneyMode.enabled && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={moneyMode.currency}
                  onChange={(e) => setMoneyMode((m) => ({ ...m, currency: e.target.value }))}
                  style={{ background: '#0f172a', color: '#fff', border: '1px solid #334155', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="number"
                  min={0.01}
                  step={0.5}
                  value={moneyMode.buyIn}
                  onChange={(e) => setMoneyMode((m) => ({ ...m, buyIn: parseFloat(e.target.value) || 0 }))}
                  style={{ width: 70, background: '#0f172a', color: '#fff', border: '1px solid #334155', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>per player</span>
              </div>
            )}
            {moneyMode.enabled && (
              <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
                Each chip = {(moneyMode.buyIn / gameState.startingChips).toFixed(4)} {moneyMode.currency}
              </p>
            )}
          </div>
        )}

        {transport?.role === 'host' && gameState.players.filter((p) => !p.isSpectator).length >= 2 && (
          <button onClick={() => transport.startGame()}>Start Game</button>
        )}

        <button onClick={handleLeave}>Leave</button>
        <DevLogPanel />
      </Layout>
    )
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return (
    <Layout>
      <CommitBadge />
      <p style={{ opacity: 0.5 }}>Please wait…</p>
      <button onClick={handleLeave}>Leave</button>
      <DevLogPanel />
    </Layout>
  )
}

// ── Commit badge ────────────────────────────────────────────────────────────

function CommitBadge() {
  return (
    <div style={{ position: 'fixed', top: 8, right: 8, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: '#64748b', fontFamily: 'monospace', zIndex: 100 }}>
      {__GIT_COMMIT__}
    </div>
  )
}

// ── Manual QR fallback ──────────────────────────────────────────────────────

function ManualFallback({ value }: { value: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ width: '100%', maxWidth: 320, textAlign: 'center' }}>
      <button style={{ opacity: 0.45, fontSize: 12 }} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide text' : 'Can\'t scan? Show QR text'}
      </button>
      {open && (
        <textarea
          readOnly
          rows={5}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 10, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: 8, boxSizing: 'border-box', marginTop: 6 }}
          value={value}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      )}
    </div>
  )
}

// ── Dev log panel ────────────────────────────────────────────────────────────

function DevLogPanel() {
  const logs = useSyncExternalStore(subscribeDevLogs, getDevLogs)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [open, logs])

  const levelColor: Record<string, string> = {
    info: '#94a3b8', warn: '#fbbf24', error: '#f87171', debug: '#64748b',
  }

  return (
    <div style={{ width: '100%', maxWidth: 500, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <button style={{ fontSize: 12, opacity: 0.6, padding: '2px 8px' }} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'} dev log ({logs.length})
        </button>
        {open && (
          <button style={{ fontSize: 11, opacity: 0.4, padding: '2px 8px' }} onClick={clearDevLogs}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, maxHeight: 280, overflowY: 'auto', padding: 8 }}>
          {logs.length === 0 && <p style={{ opacity: 0.3, fontSize: 12, margin: 0, textAlign: 'center' }}>No logs yet</p>}
          {(logs as readonly LogEntry[]).map((entry) => (
            <div key={entry.id} style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5, borderBottom: '1px solid #1e293b', paddingBottom: 2, marginBottom: 2 }}>
              <span style={{ color: '#475569' }}>{new Date(entry.ts).toISOString().slice(11, 23)}</span>
              {' '}
              <span style={{ color: levelColor[entry.level] ?? '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase', fontSize: 10 }}>{entry.level}</span>
              {' '}
              <span style={{ color: '#cbd5e1' }}>{entry.msg}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      gap: 14, padding: '56px 24px 24px', background: '#0f172a', color: '#f1f5f9',
      fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box',
    }}>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>{children}</div>
}
