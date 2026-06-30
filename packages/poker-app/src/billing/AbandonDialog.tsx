import type { Bill, PlayerBill } from './types'
import { formatAbandonMessage } from './format'

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, padding: 16,
}
const box: React.CSSProperties = {
  background: '#1e293b', borderRadius: 14, padding: 24,
  width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14,
}

interface Props {
  bill: Bill
  myBill: PlayerBill
  onConfirm: () => void
  onCancel: () => void
}

export function AbandonDialog({ bill, myBill, onConfirm, onCancel }: Props) {
  const myDebts = bill.debts.filter((d) => d.from === myBill.name)
  const myWins  = bill.debts.filter((d) => d.to   === myBill.name)
  const msg = formatAbandonMessage(bill, myBill)

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
        <h2 style={{ margin: 0, color: '#f87171' }}>Leave game?</h2>
        <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
          Your chips will be removed. This cannot be undone.
        </p>

        <div style={{ background: '#0f172a', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>Your chips</span>
            <span style={{ fontWeight: 'bold' }}>{myBill.endChips} / {myBill.startChips}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>Your balance</span>
            <span style={{ fontWeight: 'bold', color: myBill.deltaAmount >= 0 ? '#4ade80' : '#f87171' }}>
              {myBill.deltaAmount >= 0 ? '+' : ''}{myBill.deltaAmount.toFixed(2)} {bill.currency}
            </span>
          </div>
        </div>

        {myDebts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#f87171', fontWeight: 'bold' }}>You owe:</p>
            {myDebts.map((d, i) => (
              <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 12px', fontSize: 14, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#4ade80' }}>{d.to}</span>
                <span style={{ fontWeight: 'bold', color: '#f87171' }}>{d.amount.toFixed(2)} {bill.currency}</span>
              </div>
            ))}
          </div>
        )}

        {myWins.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#4ade80', fontWeight: 'bold' }}>You are owed:</p>
            {myWins.map((d, i) => (
              <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 12px', fontSize: 14, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#f87171' }}>{d.from}</span>
                <span style={{ fontWeight: 'bold', color: '#4ade80' }}>{d.amount.toFixed(2)} {bill.currency}</span>
              </div>
            ))}
          </div>
        )}

        {myDebts.length === 0 && myWins.length === 0 && (
          <p style={{ margin: 0, color: '#4ade80', textAlign: 'center' }}>All square — no debts!</p>
        )}

        <button onClick={share} style={{ background: '#25D366', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 'bold', cursor: 'pointer', color: '#fff' }}>
          Share / Copy bill first
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onConfirm} style={{ flex: 1, background: '#dc2626', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 'bold', cursor: 'pointer', color: '#fff' }}>
            Leave anyway
          </button>
          <button onClick={onCancel} style={{ flex: 1, background: '#334155', border: 'none', borderRadius: 8, padding: '10px 0', cursor: 'pointer', color: '#fff' }}>
            Stay
          </button>
        </div>
      </div>
    </div>
  )
}
