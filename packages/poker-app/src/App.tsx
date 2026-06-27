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
          hostOnline, hostOffline, hostSonic, joinFromQR, joinSonic,
          scanNextGuest, onAnswerScanned, leave } = useTransport()

  function handleLeave() { leave(); setView('home') }

  const [view, setView] = useState<'home' | 'host-name' | 'host' | 'join' | 'scan-answer'>('home')
  const [name, setName] = useState(() => localStorage.getItem('poker-username') ?? '')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [showQR, setShowQR] = useState(false)

  const hasDisconnected = gameState?.players.some((p) => p.status === 'disconnected') ?? false
  const isOnlineHost = transport?.role === 'host' && qrPayload && pairing.step === 'idle'
  const isOfflineHost = transport?.role === 'host' && 'offerNext' in transport

  // ── Home ──────────────────────────────────────────────────────────────
  if (view === 'home') return (
    <Layout title="Poker">
      <button onClick={() => setView('host-name')}>Host</button>
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
      <button
        disabled={!name.trim()}
        style={{ width: '100%', maxWidth: 280 }}
        onClick={() => { hostSonic(name.trim()); setView('host') }}
      >
        Offline (Sonic) 🔊
      </button>
      <button onClick={() => setView('home')}>Back</button>
    </Layout>
  )

  // ── Join: enter name then scan QR or type room code ───────────────────
  if (view === 'join' && !transport) return (
    <Layout title="Join game">
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {name.trim() && (
        <>
          <QRScanner onScan={(raw) => joinFromQR(raw, name.trim())} />
          <p style={{ opacity: 0.4, fontSize: 13 }}>— or enter room code —</p>
          <Row>
            <input
              placeholder="ABCD"
              value={roomCodeInput}
              maxLength={4}
              style={{ width: 100, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 4 }}
              onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
            />
            <button
              disabled={roomCodeInput.length !== 4}
              onClick={() => joinFromQR(
                JSON.stringify({ mode: 'peer', peerId: roomCodeInput }),
                name.trim()
              )}
            >
              Rejoin
            </button>
          </Row>
        </>
      )}
      <button
        style={{ width: '100%', maxWidth: 280 }}
        onClick={() => { joinSonic(name.trim()); setView('join') }}
        disabled={!name.trim()}
      >
        Listen for game (Sonic) 🎙️
      </button>
      <button onClick={() => setView('home')}>Back</button>
    </Layout>
  )

  // ── Sonic screens ─────────────────────────────────────────────────────
  if (pairing.step === 'host-sonic-playing') return (
    <Layout title="Playing offer…">
      <p style={{ fontSize: 48 }}>🔊</p>
      <p style={{ opacity: 0.7, textAlign: 'center', maxWidth: 260 }}>
        Hold your phone close to the guest's phone
      </p>
      <p style={{ opacity: 0.4, fontSize: 13 }}>Transmitting offer tone (ultrasonic)</p>
      <button onClick={handleLeave}>Cancel</button>
    </Layout>
  )

  if (pairing.step === 'host-sonic-listening') return (
    <Layout title="Listening…">
      <p style={{ fontSize: 48 }}>🎙️</p>
      <p style={{ opacity: 0.7, textAlign: 'center', maxWidth: 260 }}>
        Guest: tap "Listen for game" then hold phones together
      </p>
      <p style={{ opacity: 0.4, fontSize: 13 }}>Waiting for answer tone</p>
      <button onClick={handleLeave}>Cancel</button>
    </Layout>
  )

  if (pairing.step === 'guest-sonic-listening') return (
    <Layout title="Listening…">
      <p style={{ fontSize: 48 }}>🎙️</p>
      <p style={{ opacity: 0.7, textAlign: 'center', maxWidth: 260 }}>
        Hold your phone close to the host's phone
      </p>
      <p style={{ opacity: 0.4, fontSize: 13 }}>Waiting for offer tone</p>
      <button onClick={handleLeave}>Cancel</button>
    </Layout>
  )

  if (pairing.step === 'guest-sonic-playing') return (
    <Layout title="Playing answer…">
      <p style={{ fontSize: 48 }}>🔊</p>
      <p style={{ opacity: 0.7, textAlign: 'center', maxWidth: 260 }}>
        Hold your phone close to the host's phone
      </p>
      <p style={{ opacity: 0.4, fontSize: 13 }}>Transmitting answer tone (ultrasonic)</p>
      <button onClick={handleLeave}>Cancel</button>
    </Layout>
  )

  // ── Error ─────────────────────────────────────────────────────────────
  if (error) return (
    <Layout title={error === 'Host left the game' ? 'Game ended' : 'Error'}>
      <p style={{ opacity: 0.6 }}>{error}</p>
      <button onClick={handleLeave}>Back to home</button>
    </Layout>
  )

  // ── Host waiting for PeerJS broker ────────────────────────────────────
  if (view === 'host' && pairing.step === 'idle' && !qrPayload && !gameState) return (
    <Layout title="Connecting…">
      <p style={{ opacity: 0.5 }}>Connecting to PeerJS broker…</p>
      <button onClick={handleLeave}>Cancel</button>
    </Layout>
  )

  // ── Guest: show answer QR for host to scan (offline) ──────────────────
  if (pairing.step === 'guest-answering' && qrPayload) return (
    <Layout title="Show this to the host">
      <QRDisplay value={qrPayload} label="Host scans your screen" />
      <p style={{ opacity: 0.6, fontSize: 13 }}>Hold still — host is scanning your answer</p>
      <button onClick={handleLeave}>Leave</button>
    </Layout>
  )

  // ── Host offline: show offer QR ───────────────────────────────────────
  if (pairing.step === 'host-offering' && qrPayload) return (
    <Layout title="Let players scan">
      <QRDisplay value={qrPayload} label={`Guest ${(pairing as { slot: number }).slot + 1} — scan to join`} />
      <PlayerList gameState={gameState} />
      <Row>
        {gameState && gameState.players.length >= 2 && (
          <button onClick={() => transport?.startGame()}>Start Game</button>
        )}
        <button onClick={scanNextGuest}>Scan guest's answer →</button>
        <button onClick={handleLeave}>Cancel</button>
      </Row>
    </Layout>
  )

  // ── Host: scanning guest's answer QR ──────────────────────────────────
  if (pairing.step === 'host-scanning') return (
    <Layout title="Scan guest's screen">
      <QRScanner onScan={(raw) => { onAnswerScanned(raw); setView('host') }} />
      <button onClick={handleLeave}>Leave</button>
    </Layout>
  )

  // ── In game ───────────────────────────────────────────────────────────
  if (gameState?.currentTurnPlayerId) return (
    <Layout title={`${gameState.street.toUpperCase()}`}>
      <p style={{ fontSize: 13, opacity: 0.4, letterSpacing: 3 }}>{gameState.roomCode}</p>
      <p>Community: {gameState.communityCards.map((c) => `${c.rank}${suitSym(c.suit)}`).join(' ') || '—'}</p>
      <p>Pot: {gameState.pots.reduce((s, p) => s + p.amount, 0)}</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {gameState.players.map((p) => (
          <li key={p.id} style={{ padding: '4px 0', fontWeight: p.id === gameState.currentTurnPlayerId ? 'bold' : 'normal', opacity: p.hasFolded ? 0.4 : p.status === 'disconnected' ? 0.3 : 1 }}>
            {p.name} — {p.chips} chips
            {p.id === gameState.currentTurnPlayerId ? ' ◀' : ''}
            {p.status === 'disconnected' ? ' (disconnected)' : ''}
          </li>
        ))}
      </ul>
      {transport?.role === 'host' && (
        <Row>
          {isOnlineHost && (
            <button onClick={() => setShowQR((v) => !v)}>
              {showQR ? 'Hide QR' : 'Show QR'}
            </button>
          )}
          {isOfflineHost && hasDisconnected && (
            <button onClick={() => (transport as { offerNext(): void }).offerNext()}>
              Reconnect player
            </button>
          )}
        </Row>
      )}
      {showQR && qrPayload && (
        <QRDisplay value={qrPayload} label={`Room ${gameState.roomCode}`} />
      )}
      <button onClick={handleLeave}>Leave game</button>
    </Layout>
  )

  // ── Lobby ─────────────────────────────────────────────────────────────
  if (gameState && gameState.players.length > 0 && !gameState.currentTurnPlayerId) return (
    <Layout title={`Room ${gameState.roomCode}`}>
      {/* Online host: always show QR + room code so guests can join */}
      {isOnlineHost && qrPayload && (
        <>
          <p style={{ fontSize: 28, fontWeight: 'bold', letterSpacing: 6 }}>{gameState.roomCode}</p>
          <QRDisplay value={qrPayload} label="Scan to join" />
        </>
      )}
      <PlayerList gameState={gameState} />
      {transport?.role === 'host' && (
        <Row>
          {gameState.players.length >= 2 && (
            <button onClick={() => transport.startGame()}>Start Game</button>
          )}
          {isOfflineHost && (
            <button onClick={() => (transport as { offerNext(): void }).offerNext()}>
              {hasDisconnected ? 'Reconnect player' : 'Add player'}
            </button>
          )}
        </Row>
      )}
      <button onClick={handleLeave}>Leave</button>
    </Layout>
  )

  // ── Fallback ───────────────────────────────────────────────────────────
  return (
    <Layout title="Connecting…">
      <p style={{ opacity: 0.5 }}>Please wait</p>
      <button onClick={handleLeave}>Leave</button>
    </Layout>
  )
}

// ── Shared player list ─────────────────────────────────────────────────────

function PlayerList({ gameState }: { gameState: import('poker-engine').GameState | null }) {
  if (!gameState || gameState.players.length === 0) return null
  return (
    <div style={{ width: '100%', maxWidth: 280 }}>
      <p style={{ opacity: 0.5, fontSize: 13, marginBottom: 6 }}>
        Players ({gameState.players.length}/8)
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {gameState.players.map((p) => (
          <li key={p.id} style={{ padding: '4px 0', fontSize: 15, opacity: p.status === 'connected' ? 1 : 0.4 }}>
            {p.isHost ? '👑 ' : '• '}{p.name}
            {p.status === 'disconnected' ? ' (disconnected)' : ''}
          </li>
        ))}
      </ul>
    </div>
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
