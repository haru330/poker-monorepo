import type { GameState } from 'poker-engine'
import { dealNewHand, applyAction, abandonPlayer } from 'poker-engine'
import type { ClientMessage, PairingPhase, QRAnswer, QRPayload, ServerMessage, Transport } from './types'
import { compressSdp, decompressSdp, compressSdpToBytes, decompressSdpFromBytes } from './sdp'
import { devLog } from '../devLog'
import { createPlayer, INITIAL_STATE, filterStateForPlayer } from './utils'

// Offline mode = same WiFi/hotspot. STUN gives real srflx IPs so iOS mDNS obfuscation
// doesn't break connections. TURN is a fallback only — direct is still tried first —
// because Personal Hotspot often uses symmetric/carrier-grade NAT where STUN alone
// can't establish a direct path even though both devices are on the same network.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
}

function waitForICE(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    const timer = setTimeout(resolve, timeoutMs)
    pc.addEventListener('icegatheringstatechange', function handler() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer)
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
  onDevPing: (playerName: string) => void
}

export class RTCHostTransport implements Transport {
  readonly role = 'host' as const
  connected = true

  private peers: RTCPeerConnection[] = []
  private channels: RTCDataChannel[] = []
  private slotToPlayer = new Map<number, string>()
  private state: GameState = INITIAL_STATE
  private opts: RTCHostOptions
  private hostPlayerId: string
  private allInRevealCount = 0

  constructor(opts: RTCHostOptions) {
    this.opts = opts
    devLog('info', `[RTCHost] created, hostName=${opts.hostName}`)
    const token = localStorage.getItem('poker-session-token') ?? crypto.randomUUID()
    localStorage.setItem('poker-session-token', token)
    this.hostPlayerId = token
    const player = createPlayer(token, opts.hostName, this.state.startingChips, true)
    this.state = { ...this.state, players: [player] }
    opts.onState(filterStateForPlayer(this.state, this.hostPlayerId))
  }

  async offerNext(): Promise<void> {
    const slot = this.peers.length
    devLog('info', `[RTCHost] offerNext slot=${slot}`)
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const ch = pc.createDataChannel('poker', { ordered: true })

    ch.onmessage = (ev) => this.handleGuestMessage(slot, JSON.parse(ev.data) as ClientMessage)
    ch.onopen    = () => {
      devLog('info', `[RTCHost] channel open slot=${slot}, sending STATE`)
      this.sendToGuest(slot, { type: 'STATE', state: this.state })
    }
    ch.onclose   = () => {
      devLog('warn', `[RTCHost] channel closed slot=${slot}`)
      this.handleGuestDisconnect(slot)
    }

    pc.oniceconnectionstatechange = () => {
      devLog('debug', `[RTCHost] ICE state slot=${slot}: ${pc.iceConnectionState}`)
      if (pc.iceConnectionState === 'failed') {
        this.opts.onError('Could not reach guest — make sure both devices are on the same hotspot or Wi-Fi network.')
      }
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      const type = ev.candidate.type ?? 'unknown'
      if (type === 'relay') {
        devLog('info', `[RTCHost] TURN relay candidate slot=${slot} — falling back to TURN server (cross-network)`)
      } else {
        devLog('debug', `[RTCHost] ICE candidate slot=${slot} type=${type}`)
      }
    }

    this.peers.push(pc)
    this.channels.push(ch)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    devLog('info', `[RTCHost] waiting for ICE gathering slot=${slot}`)
    await waitForICE(pc)
    devLog('info', `[RTCHost] ICE gathered slot=${slot}, showing QR`)

    const payload: QRPayload = { mode: 'rtc', offer: compressSdp(pc.localDescription!.sdp), slot }
    this.opts.onPairing({ step: 'host-offering', offer: JSON.stringify(payload), slot })
  }

  async completeHandshake(raw: string): Promise<void> {
    try {
      devLog('info', `[RTCHost] completeHandshake raw.length=${raw.length}`)
      const qrAnswer = JSON.parse(raw) as QRAnswer
      const pc = this.peers[qrAnswer.slot]
      if (!pc) { this.opts.onError(`no peer for slot ${qrAnswer.slot}`); return }
      await pc.setRemoteDescription({ type: 'answer', sdp: decompressSdp(qrAnswer.answer) })
      devLog('info', `[RTCHost] remote description set slot=${qrAnswer.slot}, awaiting ICE`)
      this.opts.onPairing({ step: 'done' })
    } catch (e) {
      devLog('error', `[RTCHost] completeHandshake error: ${e}`)
      this.opts.onError(`Handshake failed: ${e}`)
    }
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]): void {
    devLog('info', `[RTCHost] sendAction ${action.type}`)
    this.runAction(action)
  }

  startGame(): void {
    devLog('info', `[RTCHost] startGame, players=${this.state.players.length}`)
    this.allInRevealCount = 0
    setTimeout(() => {
      const players = this.state.players.map((p) => ({ ...p, chips: this.state.startingChips }))
      this.state = dealNewHand({ ...this.state, players })
      devLog('info', `[RTCHost] game started, turn=${this.state.currentTurnPlayerId}`)
      this.broadcastState()
    }, 0)
  }

  nextHand(): void {
    devLog('info', `[RTCHost] nextHand`)
    this.allInRevealCount = 0
    setTimeout(() => {
      this.state = dealNewHand(this.state)
      this.broadcastState()
    }, 0)
  }

  revealCard(): void {
    devLog('info', `[RTCHost] revealCard, count=${this.allInRevealCount}`)
    if (this.state.street === 'showdown' && this.allInRevealCount < 5) {
      this.allInRevealCount++
      this.broadcastState()
    }
  }

  toggleSpectator(): void {
    if (this.state.handNumber !== 0) return
    devLog('info', `[RTCHost] toggleSpectator for host`)
    this.state = {
      ...this.state,
      players: this.state.players.map((p) =>
        p.id === this.hostPlayerId ? { ...p, isSpectator: !p.isSpectator } : p
      ),
    }
    this.broadcastState()
  }

  abandon(): void { /* host cannot abandon */ }

  devPing(playerName: string): void {
    devLog('info', `[RTCHost] host devPing: ${playerName}`)
    this.opts.onDevPing(playerName)
    const broadcast: ServerMessage = { type: 'DEV_PING_BROADCAST', playerName }
    this.channels.forEach((ch) => { if (ch.readyState === 'open') ch.send(JSON.stringify(broadcast)) })
  }

  leave(): void {
    this.channels.forEach((ch) => ch.close())
    this.peers.forEach((pc) => pc.close())
  }

  // Defer applyAction through setTimeout so the browser can paint a loading state
  // before the synchronous equity computation blocks the main thread.
  private runAction(action: Parameters<typeof applyAction>[1]): void {
    setTimeout(() => {
      const prevCommunityCount = this.state.communityCards.length
      const prevStreet = this.state.street
      this.state = applyAction(this.state, action)
      if (this.state.street === 'showdown' && prevStreet !== 'showdown' && this.state.lastAllInCallerId) {
        this.allInRevealCount = prevCommunityCount
      }
      this.broadcastState()
    }, 0)
  }

  private stateWithReveal(): GameState {
    return this.state.lastAllInCallerId && this.state.street === 'showdown'
      ? { ...this.state, allInRevealCount: this.allInRevealCount }
      : this.state
  }

  private broadcastState(): void {
    devLog('debug', `[RTCHost] broadcasting STATE, channels=${this.channels.length}, turn=${this.state.currentTurnPlayerId}`)
    const s = this.stateWithReveal()
    this.opts.onState(filterStateForPlayer(s, this.hostPlayerId))
    this.channels.forEach((ch, slot) => {
      if (ch.readyState !== 'open') { devLog('warn', `[RTCHost] channel not open (${ch.readyState}), STATE not sent`); return }
      const peerId = this.slotToPlayer.get(slot)
      const filtered = peerId ? filterStateForPlayer(s, peerId) : s
      ch.send(JSON.stringify({ type: 'STATE', state: filtered } satisfies ServerMessage))
    })
  }

  private sendToGuest(slot: number, msg: ServerMessage): void {
    const ch = this.channels[slot]
    if (ch?.readyState === 'open') ch.send(JSON.stringify(msg))
  }

  private handleGuestMessage(slot: number, msg: ClientMessage): void {
    devLog('debug', `[RTCHost] rx from slot=${slot}: ${msg.type}`)
    switch (msg.type) {
      case 'JOIN': {
        this.slotToPlayer.set(slot, msg.sessionToken)
        const existing = this.state.players.find((p) => p.id === msg.sessionToken)
        if (existing) {
          devLog('info', `[RTCHost] reconnect slot=${slot}: ${existing.name}`)
          this.state = {
            ...this.state,
            players: this.state.players.map((p) =>
              p.id === msg.sessionToken ? { ...p, status: 'connected' } : p,
            ),
          }
        } else if (this.state.players.length < 8) {
          const player = createPlayer(msg.sessionToken, msg.name, this.state.startingChips, false)
          this.state = { ...this.state, players: [...this.state.players, player] }
          devLog('info', `[RTCHost] player joined slot=${slot}: ${msg.name} (${this.state.players.length} total)`)
        } else {
          devLog('warn', `[RTCHost] JOIN rejected: table full`)
          this.sendToGuest(slot, { type: 'JOIN_REJECTED', reason: 'table is full' })
          break
        }
        this.sendToGuest(slot, { type: 'JOIN_OK', sessionToken: msg.sessionToken })
        this.broadcastState()
        break
      }
      case 'ACTION':
        if (msg.action.playerId === this.state.currentTurnPlayerId) {
          devLog('info', `[RTCHost] action ${msg.action.type} slot=${slot}`)
          this.runAction(msg.action)
        }
        break
      case 'ABANDON': {
        const apid = this.slotToPlayer.get(slot)
        if (apid) {
          devLog('info', `[RTCHost] ABANDON slot=${slot} pid=${apid}`)
          this.state = abandonPlayer(this.state, apid)
          this.broadcastState()
        }
        break
      }
      case 'TOGGLE_SPECTATOR': {
        const pid = this.slotToPlayer.get(slot)
        if (pid && this.state.handNumber === 0) {
          devLog('info', `[RTCHost] TOGGLE_SPECTATOR slot=${slot} pid=${pid}`)
          this.state = {
            ...this.state,
            players: this.state.players.map((p) =>
              p.id === pid ? { ...p, isSpectator: !p.isSpectator } : p
            ),
          }
          this.broadcastState()
        }
        break
      }
      case 'REVEAL_CARD':
        devLog('info', `[RTCHost] REVEAL_CARD from slot=${slot}`)
        if (this.state.street === 'showdown' && this.allInRevealCount < 5) {
          this.allInRevealCount++
          this.broadcastState()
        }
        break
      case 'DEV_PING': {
        devLog('info', `[RTCHost] DEV_PING from slot=${slot}: ${msg.playerName}`)
        this.opts.onDevPing(msg.playerName)
        const broadcast: ServerMessage = { type: 'DEV_PING_BROADCAST', playerName: msg.playerName }
        this.channels.forEach((ch) => { if (ch.readyState === 'open') ch.send(JSON.stringify(broadcast)) })
        break
      }
      case 'PING':
        this.sendToGuest(slot, { type: 'PONG' })
        break
    }
  }

  private handleGuestDisconnect(slot: number): void {
    const playerId = this.slotToPlayer.get(slot)
    devLog('warn', `[RTCHost] guest disconnected slot=${slot}, playerId=${playerId ?? 'unknown'}`)
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
  payload?: QRPayload & { mode: 'rtc' }
  offerSdpRaw?: { sdp: string; slot: number }
  name: string
  onState: (s: GameState) => void
  onAnswer?: (phase: PairingPhase) => void
  onAnswerBytes?: (bytes: Uint8Array, slot: number) => void
  onRejected: (reason: string) => void
  onDevPing: (playerName: string) => void
}

export class RTCGuestTransport implements Transport {
  readonly role = 'guest' as const
  connected = false
  private pc: RTCPeerConnection
  private ch: RTCDataChannel | null = null
  private opts: RTCGuestOptions

  constructor(opts: RTCGuestOptions) {
    this.opts = opts
    devLog('info', `[RTCGuest] created, name=${opts.name}`)
    this.pc = new RTCPeerConnection(RTC_CONFIG)

    this.pc.oniceconnectionstatechange = () => {
      devLog('debug', `[RTCGuest] ICE state: ${this.pc.iceConnectionState}`)
      if (this.pc.iceConnectionState === 'failed') {
        opts.onRejected('Could not reach host — make sure both devices are on the same hotspot or Wi-Fi network.')
      }
    }

    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      const type = ev.candidate.type ?? 'unknown'
      if (type === 'relay') {
        devLog('info', `[RTCGuest] TURN relay candidate — falling back to TURN server (cross-network)`)
      } else {
        devLog('debug', `[RTCGuest] ICE candidate type=${type}`)
      }
    }

    this.pc.ondatachannel = (ev) => {
      devLog('info', `[RTCGuest] data channel received`)
      this.ch = ev.channel
      this.ch.onopen = () => {
        this.connected = true
        devLog('info', `[RTCGuest] channel open, sending JOIN`)
        const token = localStorage.getItem('poker-session-token') ?? crypto.randomUUID()
        localStorage.setItem('poker-session-token', token)
        const msg: ClientMessage = { type: 'JOIN', name: opts.name, sessionToken: token }
        this.ch!.send(JSON.stringify(msg))
      }
      this.ch.onmessage = (e) => this.handleHostMessage(JSON.parse(e.data) as ServerMessage)
      this.ch.onclose = () => {
        devLog('warn', `[RTCGuest] channel closed (host left)`)
        opts.onRejected('Host left the game')
      }
    }

    this.setup()
  }

  private async setup(): Promise<void> {
    let sdp: string
    let slot: number

    if (this.opts.offerSdpRaw) {
      sdp  = this.opts.offerSdpRaw.sdp
      slot = this.opts.offerSdpRaw.slot
    } else if (this.opts.payload) {
      devLog('info', `[RTCGuest] decompressing offer SDP`)
      sdp  = decompressSdp(this.opts.payload.offer)
      slot = this.opts.payload.slot
    } else {
      this.opts.onRejected('No offer provided'); return
    }

    devLog('info', `[RTCGuest] setRemoteDescription (offer) slot=${slot}`)
    await this.pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    devLog('info', `[RTCGuest] waiting for ICE gathering`)
    await waitForICE(this.pc)
    devLog('info', `[RTCGuest] ICE gathered, emitting answer`)

    const localSdp = this.pc.localDescription!.sdp

    if (this.opts.onAnswerBytes) {
      this.opts.onAnswerBytes(compressSdpToBytes(localSdp), slot)
    } else if (this.opts.onAnswer) {
      const qrAnswer: QRAnswer = { mode: 'rtc', answer: compressSdp(localSdp), slot }
      this.opts.onAnswer({ step: 'guest-answering', answer: JSON.stringify(qrAnswer), slot })
    }
  }

  private handleHostMessage(msg: ServerMessage): void {
    devLog('debug', `[RTCGuest] rx: ${msg.type}`)
    switch (msg.type) {
      case 'STATE':
        devLog('debug', `[RTCGuest] STATE received, turn=${msg.state.currentTurnPlayerId}, players=${msg.state.players.length}`)
        this.opts.onState(msg.state); break
      case 'JOIN_REJECTED':
        devLog('warn', `[RTCGuest] JOIN_REJECTED: ${msg.reason}`)
        this.opts.onRejected(msg.reason); break
      case 'JOIN_OK':
        devLog('info', `[RTCGuest] JOIN_OK`); break
      case 'DEV_PING_BROADCAST':
        devLog('info', `[RTCGuest] DEV_PING_BROADCAST: ${msg.playerName}`)
        this.opts.onDevPing(msg.playerName); break
    }
  }

  sendAction(action: Parameters<Transport['sendAction']>[0]): void {
    this.send({ type: 'ACTION', action })
  }
  startGame(): void        { this.send({ type: 'START_GAME' }) }
  nextHand(): void         { this.send({ type: 'NEXT_HAND' }) }
  revealCard(): void       { this.send({ type: 'REVEAL_CARD' }) }
  toggleSpectator(): void  { this.send({ type: 'TOGGLE_SPECTATOR' }) }
  abandon(): void          { this.send({ type: 'ABANDON' }) }
  devPing(playerName: string): void {
    devLog('info', `[RTCGuest] sending DEV_PING: ${playerName}`)
    this.send({ type: 'DEV_PING', playerName })
  }
  leave(): void {
    this.connected = false
    this.ch?.close()
    this.pc.close()
  }

  private send(msg: ClientMessage): void {
    if (this.ch?.readyState === 'open') this.ch.send(JSON.stringify(msg))
    else devLog('warn', `[RTCGuest] tried to send ${msg.type} but channel not open`)
  }
}

// Keep these exported for potential future use — not wired to UI
export { compressSdpToBytes, decompressSdpFromBytes }
