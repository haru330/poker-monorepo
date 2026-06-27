import { deflate, inflate } from 'pako'

// ── QR path: base64url strings ─────────────────────────────────────────────

// Compress an SDP string to a base64url string for use in QR codes.
// A typical data-channel SDP is ~900 bytes; compressed it's ~300 bytes,
// which drops the QR from version 25+ (very dense) to version 15 (scannable).
export function compressSdp(sdp: string): string {
  const compressed = deflate(sdp, { level: 9 })
  return btoa(String.fromCharCode(...compressed))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function decompressSdp(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return inflate(bytes, { toText: true }) as unknown as string
}

// ── Sonic path: raw bytes ──────────────────────────────────────────────────

// For sonic transmission we skip base64url and work with raw bytes directly.
// This saves ~33% overhead — important because ggwave caps packets at 140 bytes.
export function compressSdpToBytes(sdp: string): Uint8Array {
  return deflate(sdp, { level: 9 })
}

export function decompressSdpFromBytes(bytes: Uint8Array): string {
  return inflate(bytes, { toText: true }) as unknown as string
}
