// ggwave — encode/decode binary data as ultrasonic audio tones.
// Max payload per packet: 140 bytes. We use a 2-byte header leaving 120 bytes
// of user payload per chunk so we stay safely below the limit.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no types shipped with ggwave
import ggwaveFactory from 'ggwave'

interface GGWave {
  ProtocolId: Record<string, unknown>
  getDefaultParameters(): {
    sampleRateInp: number
    sampleRateOut: number
    samplesPerFrame: number
    payloadLength: number
  }
  init(params: unknown): number
  encode(instance: number, data: Uint8Array, protocol: unknown, volume: number): Int8Array
  decode(instance: number, samples: Float32Array): Uint8Array | null
}

const CHUNK_PAYLOAD = 120   // bytes of real data per ggwave packet
const HEADER_SIZE   = 2     // [totalChunks u8, chunkIndex u8]
const VOLUME        = 15    // 0–100

// AUDIBLE_FAST makes a chirping sound but works on all phone speakers/mics.
// Switch to ULTRASOUND_FASTEST once confirmed working on target devices.
const USE_PROTOCOL = 'AUDIBLE_FAST' as const

let gw: GGWave | null = null
let gwInst = -1
let nativeSampleRate = 48000  // resolved on first use

async function getGW(): Promise<GGWave> {
  if (gw) return gw

  // Detect the device's native AudioContext sample rate before initialising
  // ggwave — a mismatch causes encode/decode to silently produce garbage.
  const probe = new AudioContext()
  nativeSampleRate = probe.sampleRate
  await probe.close()

  gw = await ggwaveFactory() as GGWave
  const p = gw.getDefaultParameters()
  p.sampleRateInp = nativeSampleRate
  p.sampleRateOut = nativeSampleRate
  gwInst = gw.init(p)
  return gw
}

// Reinterpret the Int8Array that ggwave.encode() returns as Float32 samples.
function toFloat32(raw: Int8Array): Float32Array {
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

// ── Play ──────────────────────────────────────────────────────────────────

/** Encode `data` into ultrasonic audio and play it through the speaker. */
export async function playSonicData(data: Uint8Array): Promise<void> {
  const m = await getGW()
  const totalChunks = Math.ceil(data.length / CHUNK_PAYLOAD)
  const ctx = new AudioContext({ sampleRate: nativeSampleRate })

  let nextStart = ctx.currentTime + 0.15  // brief initial silence

  for (let i = 0; i < totalChunks; i++) {
    const payload = data.slice(i * CHUNK_PAYLOAD, (i + 1) * CHUNK_PAYLOAD)
    const packet  = new Uint8Array(HEADER_SIZE + payload.length)
    packet[0] = totalChunks
    packet[1] = i
    packet.set(payload, HEADER_SIZE)

    const proto    = m.ProtocolId[`GGWAVE_PROTOCOL_${USE_PROTOCOL}`]
    const rawBytes = m.encode(gwInst, packet, proto, VOLUME)
    const samples  = toFloat32(rawBytes)

    const buf = ctx.createBuffer(1, samples.length, 48000)
    buf.getChannelData(0).set(samples)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(nextStart)

    nextStart += buf.duration + 0.15  // 150 ms gap between chunks
  }

  const totalMs = (nextStart - ctx.currentTime + 0.3) * 1000
  await new Promise<void>((res) => setTimeout(res, totalMs))
  await ctx.close()
}

// ── Listen ─────────────────────────────────────────────────────────────────

/**
 * Open the microphone and decode incoming ultrasonic packets.
 * When all chunks of a transmission have been received, `onData` is called
 * with the reassembled payload. Call `signal.abort()` to stop listening.
 */
export async function startSonicListener(
  onData: (data: Uint8Array) => void,
  signal: AbortSignal,
): Promise<void> {
  const m = await getGW()

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ctx       = new AudioContext({ sampleRate: nativeSampleRate })
  const micSrc    = ctx.createMediaStreamSource(stream)
  // ScriptProcessor is deprecated but remains the only cross-browser way
  // to feed raw PCM samples to ggwave's WASM decode loop.
  const processor = ctx.createScriptProcessor(4096, 1, 1)

  const chunks     = new Map<number, Uint8Array>()
  let totalChunks  = 0
  let delivered    = false

  processor.onaudioprocess = (e) => {
    if (delivered || signal.aborted) return
    const samples = e.inputBuffer.getChannelData(0)
    const raw     = m.decode(gwInst, samples)
    if (!raw || raw.byteLength < HEADER_SIZE) return

    const packet = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const total  = packet[0]
    const idx    = packet[1]
    if (total === 0 || idx >= total) return  // malformed

    totalChunks = total
    chunks.set(idx, packet.slice(HEADER_SIZE))

    if (chunks.size === totalChunks) {
      delivered = true
      const out: number[] = []
      for (let i = 0; i < totalChunks; i++) out.push(...(chunks.get(i) ?? []))
      onData(new Uint8Array(out))
    }
  }

  micSrc.connect(processor)
  processor.connect(ctx.destination)  // required for ScriptProcessor to fire

  const cleanup = () => {
    processor.disconnect()
    micSrc.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    ctx.close()
  }
  signal.addEventListener('abort', cleanup)
}
