import type { DeclarationProfile } from '@/lib/types'

function packageLabel(value: DeclarationProfile['packageType']) {
  return value === 'CARTON' ? 'Box' : value.replaceAll('_', ' ').toLowerCase()
}

function valueOrDash(value: string) {
  return value || '—'
}

export function DeclarationProfileCard({ initial }: { initial: DeclarationProfile }) {
  const fields = [
    ['BEAIP broker code (Submitter ID)', initial.submitterId],
    ['Declaration date', initial.declarationDate || 'Set on first submission'],
    ['Function', `${initial.declarationFunctionCode} — Original`],
    ['Regime', initial.regimeCode],
    ['Transport mode', initial.transportMode.toLowerCase()],
    ['B/L or airway bill', valueOrDash(initial.blNumber)],
    ['Container', valueOrDash(initial.containerNumber)],
    ['Seal', valueOrDash(initial.containerSealNumber)],
    ['Container fullness', valueOrDash(initial.containerFullnessCode)],
    ['Packages', `${initial.packageCount} ${packageLabel(initial.packageType)}`],
    ['Gross weight', initial.grossWeightLb ? `${initial.grossWeightLb} lb` : '—'],
    ['Net weight', initial.netWeightLb ? `${initial.netWeightLb} lb` : '—'],
    ['Goods location', valueOrDash(initial.goodsLocationCode)],
    ['Warehouse', valueOrDash(initial.warehouseCode)],
    ['Transport nationality', valueOrDash(initial.transportNationalityCode)],
  ]

  return (
    <details className="sb-card" open style={{ margin: '14px 0' }}>
      <summary style={{ padding: '12px 16px', cursor: 'pointer', fontWeight: 650, borderBottom: '1px solid var(--sb-line)' }}>
        Declaration profile <span className="sb-meta">— generated from shipment data</span>
      </summary>
      <div className="sb-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(130px, 1fr))', gap: 12 }}>
        {fields.map(([label, value]) => (
          <div key={label}>
            <div className="sb-eyebrow">{label}</div>
            <div className="sb-mono" style={{ marginTop: 4 }}>{value}</div>
          </div>
        ))}
        <div className="sb-meta" style={{ gridColumn: '1 / -1' }}>
          Edit these values on the shipment. Fixed filing identity and function values cannot be overridden on an entry.
        </div>
      </div>
    </details>
  )
}
