import { QRCodeSVG } from 'qrcode.react'

interface Props {
  value: string
  label?: string
  size?: number
}

export function QRDisplay({ value, label, size = 240 }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {label && <p style={{ margin: 0, fontSize: 14, opacity: 0.7 }}>{label}</p>}
      <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
        <QRCodeSVG value={value} size={size} level="L" />
      </div>
    </div>
  )
}
