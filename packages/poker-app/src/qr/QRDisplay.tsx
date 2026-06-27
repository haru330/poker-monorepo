import { QRCodeSVG } from 'qrcode.react'

interface Props {
  value: string
  label?: string
}

// Fill ~85% of the narrower viewport dimension so the code is as large
// as possible without overflowing. Cap at 380px on tablets/desktops.
function qrSize() {
  return Math.min(
    Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.85),
    380,
  )
}

export function QRDisplay({ value, label }: Props) {
  const size = qrSize()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      {label && <p style={{ margin: 0, fontSize: 15, opacity: 0.7 }}>{label}</p>}
      <div style={{
        background: '#fff',
        padding: 20,
        borderRadius: 16,
        boxShadow: '0 0 0 4px #fff', // extra white border for scanner contrast
      }}>
        <QRCodeSVG value={value} size={size} level="L" />
      </div>
    </div>
  )
}
