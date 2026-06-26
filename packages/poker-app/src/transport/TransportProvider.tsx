import { createContext, useContext, useState, type ReactNode } from 'react'
import type { GameState } from 'poker-engine'
import type { PairingPhase, QRPayload, Transport } from './types'
import { PeerHostTransport, PeerGuestTransport } from './peer'
import { RTCHostTransport, RTCGuestTransport } from './rtc'

interface TransportCtx {
  transport: Transport | null
  gameState: GameState | null
  pairing: PairingPhase
  qrPayload: string | null        // JSON string to render as QR on host screen
  error: string | null

  // Entry points — called from the lobby UI
  hostOnline(): void
  hostOffline(): void
  joinFromQR(raw: string, name: string): void

  // Offline-only pairing flow
  scanNextGuest(): void           // host ready to scan guest's answer QR
  onAnswerScanned(raw: string): void  // host feeds in scanned answer
}

const Ctx = createContext<TransportCtx | null>(null)

export function useTransport(): TransportCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTransport must be used inside TransportProvider')
  return ctx
}

export function TransportProvider({ children }: { children: ReactNode }) {
  const [transport, setTransport] = useState<Transport | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [pairing, setPairing] = useState<PairingPhase>({ step: 'idle' })
  const [qrPayload, setQrPayload] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rtcHost, setRtcHost] = useState<RTCHostTransport | null>(null)

  function hostOnline() {
    const t = new PeerHostTransport({
      onState: setGameState,
      onQR: (payload: QRPayload) => setQrPayload(JSON.stringify(payload)),
      onError: setError,
    })
    setTransport(t)
  }

  function hostOffline() {
    const t = new RTCHostTransport({
      onState: setGameState,
      onPairing: (phase) => {
        setPairing(phase)
        // When the host has an offer ready, expose it as the QR payload
        if (phase.step === 'host-offering' && phase.offer) {
          setQrPayload(phase.offer)
        }
      },
      onError: setError,
    })
    // Add the host as the first player
    setRtcHost(t)
    setTransport(t)
    // Immediately generate the first guest offer
    t.offerNext()
  }

  function joinFromQR(raw: string, name: string) {
    let payload: QRPayload
    try { payload = JSON.parse(raw) } catch { setError('Invalid QR code'); return }

    if (payload.mode === 'peer') {
      const t = new PeerGuestTransport({
        payload,
        name,
        onState: setGameState,
        onRejected: setError,
      })
      setTransport(t)
      return
    }

    if (payload.mode === 'rtc') {
      const t = new RTCGuestTransport({
        payload,
        name,
        onState: setGameState,
        onAnswer: (phase) => {
          setPairing(phase)
          // Expose the answer SDP as a QR for the guest to show the host
          if (phase.step === 'guest-answering') setQrPayload(phase.answer)
        },
        onRejected: setError,
      })
      setTransport(t)
    }
  }

  // Host signals they are ready to scan the current guest's answer QR
  function scanNextGuest() {
    if (!rtcHost) return
    const slot = pairing.step === 'host-offering' ? (pairing as { slot: number }).slot : 0
    setPairing({ step: 'host-scanning', slot })
    setQrPayload(null)
  }

  // Host feeds in the raw string from the scanned answer QR
  function onAnswerScanned(raw: string) {
    rtcHost?.completeHandshake(raw)
  }

  return (
    <Ctx.Provider value={{
      transport, gameState, pairing, qrPayload, error,
      hostOnline, hostOffline, joinFromQR,
      scanNextGuest, onAnswerScanned,
    }}>
      {children}
    </Ctx.Provider>
  )
}
