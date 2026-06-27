import type { GameState } from 'poker-engine'
import { dealNewHand, applyAction } from 'poker-engine'
import type { ClientMessage, PairingPhase, QRAnswer, QRPayload, ServerMessage, Transport } from './types'
import { compressSdp, decompressSdp } from './sdp'

// STUN helps discover reflexive candidates on home WiFi networks.
// On a personal hotspot (no internet) it times out gracefully and
// host-only candidates (LAN IPs) are still used.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

// Wait for ICE gathering to finish so the SDP contains all candidates.
// On LAN this is fast (<200ms) since only host-reflexive candidates are needed.
function waitForICE(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    pc.addEventListener('icegatheringstatechange', function handler() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', handler)
        resolve()
      }
    })
  })
}

// ── Host ──────────────────────────────────────────────────────────────────

export interface RTCHostOptions {
  hostName: string
  onState: (s: GameState) => void
  onPairing: (phase: PairingPhase) => void
  onError: (reason: string) => void
}

export class RTCHostTransport implements Transport {
  readonly role = 'host' as const
  connected = true  // host is always "connected" to itself

  private peers: RTCPeerConnection[] = []
  private channels: RTCDataChannel[] = []
  private slotToPlayer = new Map<number, string>()  // slot → playerId
  private state: GameState = INITIAL_STATE
  private opts: RTCHostOptions

  constructor(opts: RTCHostOptions) {
    this.opts = opts
    // Add host as first player immediately
    const token = localStorage.getItem('poker-session-token') ?? crypto.randomUUID()
    localStorage.setItem('poker-session-token', token)
    const player = createPlayer(token, opts.hostName, this.state.startingChips, true)
    this.state = { ...this.state, players: [player] }
    opts.onState(this.state)
  }

  /** Call once per guest. Shows offer QR, waits for answer to be fed in via completeHandshake(). */
  async offerNext(): Promise<void> {
    const slot = this.peers.length
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const ch = pc.createDataChannel('poker', { ordered: true })

    ch.onmessage = (ev) => this.handleGuestMessage(slot, JSON.parse(ev.data) as ClientMessage)
    ch.onopen  = () => this.sendToGuest(slot, { type: 'STATE', state: this.state })
    ch.onclose = () => this.handleGuestDisconnect(slot)

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this.opts.onError(
          'Could not reach guest — make sure both devices are on the same hotspot or Wi-Fi network.'
        )
      }
    }

    this.peers.push(pc)
    this.channels.push(ch)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForICE(pc)

    const payload: QRPayload = { mode: 'rtc', offer: compressSdp(pc.localDescription!.sdp), slot }
    this.opts.onPairing({ step: 'host-offering', offer: JSON.stringify(payload), slot })
  }

  /** Called when host scans the guest's answer QR. */
  async completeHandshake(raw: string): Promise<void> {
    try {
      const qrAnswer = JSON.parse(raw) as QRAnswer
      const pc = this.peers[qrAnswer.slot]
      if (!pc) { this.opts.onError(`no peer for slot ${qrAnswer.slot}`); return }
      await pc.setRemoteDescription({ type: 'answer', sdp: decompressSdp(qrAnswer.answer) })
      this.opts.onPairing({ step: 'done' })
    } catch (e) {
      this.opts.onError(`Handshake failed: ${e}`)
    }
  }

  /** Host triggers next guest pairing after current one completes. */
  pairNextGuest(): void {
    const slot = this.peers.length
    this.opts.onPairing({ step: 'host-offering', offer: '', slot }) // reset UI
    this.offerNext()
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]): void {
    this.state = applyAction(this.state, action)
    this.broadcastState()
  }

  startGame(): void {
    const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
    this.state = dealNewHand({ ...this.state, players })
    this.broadcastState()
  }

  nextHand(): void {
    this.state = dealNewHand(this.state)
    this.broadcastState()
  }

  leave(): void {
    this.channels.forEach((ch) => ch.close())
    this.peers.forEach((pc) => pc.close())
  }

  private broadcastState(): void {
    const msg: ServerMessage = { type: 'STATE', state: this.state }
    this.opts.onState(this.state)
    this.channels.forEach((ch) => {
      if (ch.readyState === 'open') ch.send(JSON.stringify(msg))
    })
  }

  private sendToGuest(slot: number, msg: ServerMessage): void {
    const ch = this.channels[slot]
    if (ch?.readyState === 'open') ch.send(JSON.stringify(msg))
  }

  private handleGuestMessage(slot: number, msg: ClientMessage): void {
    switch (msg.type) {
      case 'JOIN': {
        this.slotToPlayer.set(slot, msg.sessionToken)
        const existing = this.state.players.find((p) => p.id === msg.sessionToken)
        if (existing) {
          // Reconnect — mark them connected again
          this.state = {
            ...this.state,
            players: this.state.players.map((p) =>
              p.id === msg.sessionToken ? { ...p, status: 'connected' } : p,
            ),
          }
        } else if (this.state.players.length < 8) {
          // New player joining for the first time (lobby only)
          const player = createPlayer(msg.sessionToken, msg.name, this.state.startingChips, false)
          this.state = { ...this.state, players: [...this.state.players, player] }
        } else {
          this.sendToGuest(slot, { type: 'JOIN_REJECTED', reason: 'table is full' })
          break
        }
        this.sendToGuest(slot, { type: 'JOIN_OK', sessionToken: msg.sessionToken })
        this.broadcastState()
        break
      }
      case 'ACTION':
        if (msg.action.playerId === this.state.currentTurnPlayerId) {
          this.state = applyAction(this.state, msg.action)
          this.broadcastState()
        }
        break
      case 'PING':
        this.sendToGuest(slot, { type: 'PONG' })
        break
    }
  }

  private handleGuestDisconnect(slot: number): void {
    // Find which player owned this slot by matching the last JOIN we received
    const playerId = this.slotToPlayer.get(slot)
    if (playerId) {
      this.state = {
        ...this.state,
        players: this.state.players.map((p) =>
          p.id === playerId ? { ...p, status: 'disconnected' } : p,
        ),
      }
    }
    this.broadcastState()
  }
}

// ── Guest ─────────────────────────────────────────────────────────────────

export interface RTCGuestOptions {
  payload: QRPayload & { mode: 'rtc' }   // decoded from scanned QR
  name: string
  onState: (s: GameState) => void
  onAnswer: (phase: PairingPhase) => void // guest shows answer QR
  onRejected: (reason: string) => void
}

export class RTCGuestTransport implements Transport {
  readonly role = 'guest' as const
  connected = false
  private pc: RTCPeerConnection
  private ch: RTCDataChannel | null = null
  private opts: RTCGuestOptions

  constructor(opts: RTCGuestOptions) {
    this.opts = opts
    this.pc = new RTCPeerConnection(RTC_CONFIG)

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') {
        opts.onRejected(
          'Could not reach host — make sure both devices are on the same hotspot or Wi-Fi network.'
        )
      }
    }

    this.pc.ondatachannel = (ev) => {
      this.ch = ev.channel
      this.ch.onopen = () => {
        this.connected = true
        const token = localStorage.getItem('poker-session-token') ?? crypto.randomUUID()
        localStorage.setItem('poker-session-token', token)
        const msg: ClientMessage = { type: 'JOIN', name: opts.name, sessionToken: token }
        this.ch!.send(JSON.stringify(msg))
      }
      this.ch.onmessage = (e) => this.handleHostMessage(JSON.parse(e.data) as ServerMessage)
      this.ch.onclose = () => opts.onRejected('Host left the game')
    }

    this.setup()
  }

  private async setup(): Promise<void> {
    const { payload } = this.opts
    await this.pc.setRemoteDescription({ type: 'offer', sdp: decompressSdp(payload.offer) })
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    await waitForICE(this.pc)

    const qrAnswer: QRAnswer = { mode: 'rtc', answer: compressSdp(this.pc.localDescription!.sdp), slot: payload.slot }
    // Tell the UI to show the answer QR so the host can scan it
    this.opts.onAnswer({ step: 'guest-answering', answer: JSON.stringify(qrAnswer), slot: payload.slot })
  }

  private handleHostMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'STATE':        this.opts.onState(msg.state); break
      case 'JOIN_REJECTED': this.opts.onRejected(msg.reason); break
    }
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]): void {
    this.send({ type: 'ACTION', action })
  }

  startGame(): void { this.send({ type: 'START_GAME' }) }
  nextHand(): void  { this.send({ type: 'NEXT_HAND' }) }

  leave(): void {
    this.connected = false
    this.ch?.close()
    this.pc.close()
  }

  private send(msg: ClientMessage): void {
    if (this.ch?.readyState === 'open') this.ch.send(JSON.stringify(msg))
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function createPlayer(id: string, name: string, chips: number, isHost: boolean) {
  return {
    id, name, chips, hand: [] as never[],
    status: 'connected' as const, hasFolded: false,
    isAllIn: false, isHost, streetContribution: 0,
    totalContribution: 0, hasActed: false,
  }
}

const INITIAL_STATE = {
  roomCode: 'LOCAL',
  players: [] as never[],
  deck: [] as never[],
  communityCards: [] as never[],
  street: 'preflop' as const,
  pots: [] as never[],
  dealerButtonIndex: -1,
  currentTurnPlayerId: null,
  currentBet: 0,
  minRaise: 0,
  startingChips: 100,
  bigBlind: 2,
  actionLog: [] as never[],
  results: null,
}
