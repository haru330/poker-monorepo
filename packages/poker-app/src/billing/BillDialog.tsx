import type { Bill } from './types'
import { formatEndGameMessage } from './format'

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, padding: 16,
}
const box: React.CSSProperties = {
  background: '#1e293b', borderRadius: 14, padding: 24,
  width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14,
}

interface Props {
  bill: Bill
  onClose: () => void
}

export function BillDialog({ bill, onClose }: Props) {
  const sorted = [...bill.players].sort((a, b) => b.endChips - a.endChips)
  const msg = formatEndGameMessage(bill)

  function share() {
    if (navigator.share) {
      navigator.share({ text: msg }).catch(() => {})
    } else {
      navigator.clipboard.writeText(msg)
      alert('Copied to clipboard!')
    }
  }

  return (
    <div style={overlay}>
      <div style={box}>
        <h2 style={{ margin: 0, color: '#fbbf24' }}>🃏 Final Bill</h2>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
          Rate: {bill.startingChips} chips = {bill.buyIn.toFixed(2)} {bill.currency}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.map((p) => {
            const positive = p.deltaAmount >= 0
            return (
              <div key={p.playerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ fontWeight: 'bold' }}>{p.name}</span>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{p.endChips} chips</span>
                <span style={{ fontWeight: 'bold', color: positive ? '#4ade80' : '#f87171' }}>
                  {positive ? '+' : ''}{p.deltaAmount.toFixed(2)} {bill.currency}
                </span>
              </div>
            )
          })}
        </div>

        {bill.debts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontWeight: 'bold' }}>Settle up:</p>
            {bill.debts.map((d, i) => (
              <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}>
                <span style={{ color: '#f87171' }}>{d.from}</span>
                <span style={{ color: '#64748b' }}> → </span>
                <span style={{ color: '#4ade80' }}>{d.to}</span>
                <span style={{ float: 'right', fontWeight: 'bold' }}>{d.amount.toFixed(2)} {bill.currency}</span>
              </div>
            ))}
          </div>
        )}

        {bill.debts.length === 0 && (
          <p style={{ margin: 0, color: '#4ade80', textAlign: 'center' }}>All square — no debts! 🎉</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={share} style={{ flex: 1, background: '#25D366', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 'bold', cursor: 'pointer', color: '#fff' }}>
            Share / Copy
          </button>
          <button onClick={onClose} style={{ flex: 1, background: '#334155', border: 'none', borderRadius: 8, padding: '10px 0', cursor: 'pointer', color: '#fff' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
