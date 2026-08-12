'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateShipment, type NewShipmentOptions, type ShipmentEditDraft } from '@/lib/data/shipment-actions'

const GOODS_TYPES = ['GENERAL', 'PERSONAL_EFFECTS', 'COMMERCIAL', 'VEHICLE', 'HAZARDOUS', 'PERISHABLE']
const PACKAGE_TYPES = ['CARTON', 'CONTAINER', 'PALLET', 'CRATE', 'DRUM', 'BUNDLE', 'LOOSE', 'VEHICLE', 'OTHER']
const TRANSPORT_MODES = ['SEA', 'AIR', 'LAND']

export function ShipmentEditForm({ shipmentId, initial, options }: { shipmentId: string; initial: ShipmentEditDraft; options: NewShipmentOptions }) {
  const router = useRouter()
  const [draft, setDraft] = useState(initial)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const set = (key: keyof ShipmentEditDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft((current) => ({ ...current, [key]: event.target.value }))
  const field = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
  const text = (label: string, key: keyof ShipmentEditDraft, mono = false, type = 'text') => <label style={field}><span className="sb-eyebrow">{label}</span><input className={`sb-inp ${mono ? 'sb-mono' : ''}`} type={type} value={draft[key]} onChange={set(key)} /></label>
  const select = (label: string, key: keyof ShipmentEditDraft, values: { id: string; label: string }[], empty?: string) => <label style={field}><span className="sb-eyebrow">{label}</span><select className="sb-inp" value={draft[key]} onChange={set(key)}>{empty !== undefined && <option value="">{empty}</option>}{values.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
  const enumSelect = (label: string, key: keyof ShipmentEditDraft, values: string[]) => select(label, key, values.map((value) => ({ id: value, label: value.replaceAll('_', ' ').toLowerCase() })))

  function save() {
    if (pending) return
    setNotice(null)
    startTransition(async () => {
      const result = await updateShipment(shipmentId, draft)
      if (!result.ok) {
        setNotice(result.error ?? 'Could not update shipment')
        return
      }
      router.push(`/shipments/${shipmentId}/entry`)
      router.refresh()
    })
  }

  return (
    <>
      {notice && <div className="sb-card sb-pad" role="status" style={{ marginBottom: 12, borderLeft: '3px solid var(--sb-neg)' }}>{notice}</div>}
      <div className="sb-card sb-pad">
        <div className="sb-h2" style={{ marginBottom: 12 }}>Identity and routing</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
          {text('Shipment number', 'shipmentNumber', true)}
          {select('Client / consignee', 'clientId', options.clients)}
          {select('Manifest', 'manifestId', options.manifests, '— no manifest —')}
          {select('Declaration office', 'declarationOfficeId', options.offices)}
          {text('BL / airway bill', 'blNumber', true)}
          {enumSelect('Transport mode', 'transportMode', TRANSPORT_MODES)}
          {text('Container number', 'containerNumber', true)}
          {text('Container seal', 'containerSealNumber', true)}
          {text('Container fullness code', 'containerFullnessCode', true)}
        </div>
      </div>

      <div className="sb-card sb-pad" style={{ marginTop: 14 }}>
        <div className="sb-h2" style={{ marginBottom: 12 }}>Declaration profile</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          {text('Declaration date', 'declarationDate', true, 'date')}
          {select('Function code', 'declarationFunctionCode', [{ id: '9', label: '9 — Original' }, { id: '5', label: '5 — Amendment' }, { id: '1', label: '1 — Cancellation' }])}
          {text('Regime code', 'regimeCode', true)}
          {text('Transport nationality', 'transportNationalityCode', true)}
          {text('Goods location', 'goodsLocationCode', true)}
          {text('Warehouse', 'warehouseCode', true)}
          {enumSelect('Goods type', 'goodsType', GOODS_TYPES)}
          {enumSelect('Package type', 'packageType', PACKAGE_TYPES)}
          {text('Package count', 'packageCount', true)}
          {text('Gross weight (kg)', 'grossWeightKg', true)}
          {text('Net weight (kg)', 'netWeightKg', true)}
          <label style={{ ...field, gridColumn: 'span 4' }}><span className="sb-eyebrow">Description</span><textarea className="sb-inp" rows={2} value={draft.description} onChange={set('description')} /></label>
        </div>
      </div>

      <div className="sb-card sb-pad" style={{ marginTop: 14 }}>
        <div className="sb-h2" style={{ marginBottom: 12 }}>Landed-cost charges</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
          {text('Freight (BSD)', 'freightCharge', true)}
          {text('Insurance (BSD)', 'insuranceCharge', true)}
          {text('Other charges (BSD)', 'otherCharges', true)}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button className="sb-btn" disabled={pending} onClick={() => router.back()}>Cancel</button>
        <button className="sb-btn is-primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save shipment'}</button>
      </div>
    </>
  )
}
