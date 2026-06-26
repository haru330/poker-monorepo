import { useState } from 'react'
import { TransportProvider, useTransport } from './transport/TransportProvider'
import { QRDisplay } from './qr/QRDisplay'
import { QRScanner } from './qr/QRScanner'

export default function App() {
  return (
    <TransportProvider>
      <Screen />
    </TransportProvider>
  )
}

function Screen() {
  const { transport, gameState, pairing, qrPayload, error,
          hostOnline, hostOffline, joinFromQR,
          scanNextGuest, onAnswerScanned } = useTransport()

  const [view, setView] = useState<'home' | 'host-name' | 'host' | 'join' | 'scan-answer'>('home')
  const [name, setName] = useState(() => localStorage.getItem('poker-username') ?? '')

  // ── Home ──────────────────────────────────────────────────────────────
  if (view === 'home') return (
    <Layout title="Poker">
      <button onClick={() => setView('host-name')}>Host — Internet (P2P)</button>
      <button onClick={() => setView('host-name')}>Host — Hotspot / No internet</button>
      <button onClick={() => setView('join')}>Join (scan QR)</button>
    </Layout>
  )

  // ── Host: enter name before hosting ───────────────────────────────────
  if (view === 'host-name') return (
    <Layout title="Your name">
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Row>
        <button
          disabled={!name.trim()}
          onClick={() => {
            hostOnline(name.trim())
            setView('host')
          }}
        >
          Host Online
        </button>
        <button
          disabled={!name.trim()}
          onClick={() => {
            hostOffline(name.trim())
            setView('host')
          }}
        >
          Host Offline
        </button>
      </Row>
      <button onClick={() => setView('home')}>Back</button>
    </Layout>
  )

  // ── Join: enter name then scan ─────────────────────────────────────────
  if (view === 'join' && !transport) return (
    <Layout title="Join game">
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {name.trim() && (
        <QRScanner onScan={(raw) => joinFromQR(raw, name.trim())} />
      )}
      <button onClick={() => setView('home')}>Back</button>
    </Layout>
  )

  // ── Guest: show answer QR for host to scan (offline only) ─────────────
  if (pairing.step === 'guest-answering' && qrPayload) return (
    <Layout title="Show this to the host">
      <QRDisplay value={qrPayload} label="Host scans your screen" />
      <p style={{ opacity: 0.6, fontSize: 13 }}>Hold still — host is scanning your answer</p>
    </Layout>
  )

  // ── Host online: PeerJS connected, show join QR ───────────────────────
  if (view === 'host' && pairing.step === 'idle' && qrPayload) return (
    <Layout title="Let players scan">
      <QRDisplay value={qrPayload} label="Scan to join" />
      <button onClick={() => { transport?.leave(); setView('home') }}>Cancel</button>
    </Layout>
  )

  // ── Host offline: show offer QR + pairing progress ────────────────────
  if (view === 'host' && pairing.step === 'host-offering' && qrPayload) return (
    <Layout title="Let players scan">
      <QRDisplay value={qrPayload} label={`Guest ${(pairing as { slot: number }).slot + 1} — scan to join`} />
      <Row>
        <button onClick={scanNextGuest}>Scan guest's answer →</button>
        <button onClick={() => setView('home')}>Cancel</button>
      </Row>
    </Layout>
  )

  // ── Host: scanning guest's answer QR ──────────────────────────────────
  if (view === 'host' && pairing.step === 'host-scanning') return (
    <Layout title="Scan guest's screen">
      <QRScanner onScan={(raw) => { onAnswerScanned(raw); setView('host') }} />
    </Layout>
  )

  // ── Lobby: waiting room, players joined ───────────────────────────────
  if (gameState && gameState.street === 'preflop' && gameState.players.length > 0
      && !gameState.currentTurnPlayerId) return (
    <Layout title={`Room ${gameState.roomCode}`}>
      <p style={{ opacity: 0.6 }}>Players ({gameState.players.length}/8)</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {gameState.players.map((p) => (
          <li key={p.id} style={{ padding: '6px 0', opacity: p.status === 'connected' ? 1 : 0.4 }}>
            {p.isHost ? '👑 ' : '• '}{p.name} — {p.chips} chips
          </li>
        ))}
      </ul>
      {transport?.role === 'host' && (
        <Row>
          <button onClick={() => transport.startGame()}>Start Game</button>
          {view === 'host' && (
            <button onClick={() => {
              if (transport && 'offerNext' in transport) {
                (transport as { offerNext(): void }).offerNext()
              }
            }}>+ Add player</button>
          )}
        </Row>
      )}
    </Layout>
  )

  // ── In game: minimal state dump ───────────────────────────────────────
  if (gameState?.currentTurnPlayerId) return (
    <Layout title={`${gameState.street.toUpperCase()} — ${gameState.roomCode}`}>
      <p>Community: {gameState.communityCards.map((c) => `${c.rank}${suitSym(c.suit)}`).join(' ') || '—'}</p>
      <p>Pot: {gameState.pots.reduce((s, p) => s + p.amount, 0)}</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {gameState.players.map((p) => (
          <li key={p.id} style={{ padding: '4px 0', fontWeight: p.id === gameState.currentTurnPlayerId ? 'bold' : 'normal', opacity: p.hasFolded ? 0.4 : 1 }}>
            {p.name} — {p.chips} chips {p.id === gameState.currentTurnPlayerId ? '◀ acting' : ''}
          </li>
        ))}
      </ul>
    </Layout>
  )

  // ── Error ─────────────────────────────────────────────────────────────
  if (error) return (
    <Layout title="Error">
      <p style={{ color: '#e74c3c' }}>{error}</p>
      <button onClick={() => setView('home')}>Back</button>
    </Layout>
  )

  // ── Host waiting for PeerJS broker to assign peer ID ─────────────────
  if (view === 'host' && pairing.step === 'idle' && !qrPayload) return (
    <Layout title="Connecting…">
      <p style={{ opacity: 0.5 }}>Connecting to PeerJS broker…</p>
      <button onClick={() => { transport?.leave(); setView('home') }}>Cancel</button>
    </Layout>
  )

  // ── Fallback ───────────────────────────────────────────────────────────
  return (
    <Layout title="Connecting…">
      <p style={{ opacity: 0.5 }}>Please wait</p>
    </Layout>
  )
}

// ── Tiny layout helpers ────────────────────────────────────────────────────

function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 24, background: '#0f172a', color: '#f1f5f9',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12 }}>{children}</div>
}

function suitSym(suit: string): string {
  return { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[suit] ?? suit
}
