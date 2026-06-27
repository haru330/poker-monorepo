import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import type { GameState } from 'poker-engine'
import type { PairingPhase, QRPayload, Transport } from './types'
import { PeerHostTransport, PeerGuestTransport } from './peer'
import { RTCHostTransport, RTCGuestTransport } from './rtc'
import { devLog } from '../devLog'

interface TransportCtx {
  transport: Transport | null
  gameState: GameState | null
  pairing: PairingPhase
  qrPayload: string | null
  error: string | null
  lastPing: string | null

  hostOnline(name: string): void
  hostOffline(name: string): void
  joinFromQR(raw: string, name: string): void

  scanNextGuest(): void
  onAnswerScanned(raw: string): void

  leave(): void
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
  const [lastPing, setLastPing] = useState<string | null>(null)
  const rtcHostRef = useRef<RTCHostTransport | null>(null)

  function onDevPing(playerName: string) {
    devLog('info', `[Ping] ${playerName} pressed the button`)
    setLastPing(playerName)
  }

  function hostOnline(name: string) {
    devLog('info', `[TransportProvider] hostOnline: ${name}`)
    const t = new PeerHostTransport({
      hostName: name,
      onState: setGameState,
      onQR: (payload: QRPayload) => setQrPayload(JSON.stringify(payload)),
      onError: setError,
      onDevPing,
    })
    setTransport(t)
  }

  function hostOffline(name: string) {
    devLog('info', `[TransportProvider] hostOffline: ${name}`)
    const t = new RTCHostTransport({
      hostName: name,
      onState: setGameState,
      onPairing: (phase) => {
        setPairing(phase)
        if (phase.step === 'host-offering' && phase.offer) {
          setQrPayload(phase.offer)
        }
      },
      onError: setError,
      onDevPing,
    })
    rtcHostRef.current = t
    setTransport(t)
    t.offerNext()
  }

  function joinFromQR(raw: string, name: string) {
    devLog('info', `[TransportProvider] joinFromQR, name=${name}`)
    let payload: QRPayload
    try { payload = JSON.parse(raw) } catch {
      devLog('error', '[TransportProvider] joinFromQR: invalid JSON')
      setError('Invalid QR code')
      return
    }

    if (payload.mode === 'peer') {
      devLog('info', `[TransportProvider] joining peer peerId=${payload.peerId}`)
      const t = new PeerGuestTransport({ payload, name, onState: setGameState, onRejected: setError, onDevPing })
      setTransport(t)
      return
    }

    if (payload.mode === 'rtc') {
      devLog('info', `[TransportProvider] joining RTC slot=${payload.slot}`)
      const t = new RTCGuestTransport({
        payload,
        name,
        onState: setGameState,
        onAnswer: (phase) => {
          setPairing(phase)
          if (phase.step === 'guest-answering') setQrPayload(phase.answer)
        },
        onRejected: setError,
        onDevPing,
      })
      setTransport(t)
    }
  }

  function scanNextGuest() {
    if (!rtcHostRef.current) return
    const slot = pairing.step === 'host-offering' ? (pairing as { slot: number }).slot : 0
    devLog('info', `[TransportProvider] scanNextGuest slot=${slot}`)
    setPairing({ step: 'host-scanning', slot })
    setQrPayload(null)
  }

  function onAnswerScanned(raw: string) {
    devLog('info', `[TransportProvider] onAnswerScanned len=${raw.length}`)
    rtcHostRef.current?.completeHandshake(raw)
  }

  function leave() {
    devLog('info', '[TransportProvider] leave')
    transport?.leave()
    setTransport(null)
    setGameState(null)
    setQrPayload(null)
    setPairing({ step: 'idle' })
    setError(null)
    setLastPing(null)
    rtcHostRef.current = null
  }

  return (
    <Ctx.Provider value={{
      transport, gameState, pairing, qrPayload, error, lastPing,
      hostOnline, hostOffline, joinFromQR,
      scanNextGuest, onAnswerScanned, leave,
    }}>
      {children}
    </Ctx.Provider>
  )
}
