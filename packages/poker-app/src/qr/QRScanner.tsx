import { useEffect, useRef } from 'react'
import QrScanner from 'qr-scanner'

interface Props {
  onScan: (raw: string) => void
  onError?: (err: string) => void
}

export function QRScanner({ onScan, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)

  useEffect(() => {
    if (!videoRef.current) return

    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        scanner.stop()
        onScan(result.data)
      },
      {
        preferredCamera: 'environment',  // rear camera on phones
        highlightScanRegion: true,
        highlightCodeOutline: true,
        onDecodeError: (err) => onError?.(String(err)),
      },
    )

    scannerRef.current = scanner
    scanner.start()

    return () => { scanner.destroy() }
  }, [onScan, onError])

  return (
    <video
      ref={videoRef}
      style={{ width: '100%', maxWidth: 320, borderRadius: 12, background: '#000' }}
    />
  )
}
