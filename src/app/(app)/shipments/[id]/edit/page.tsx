import Link from 'next/link'
import { getShipmentEditData } from '@/lib/data/shipment-actions'
import { ShipmentEditForm } from './shipment-edit-form'

export default async function EditShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getShipmentEditData(id)

  return (
    <div className="sb-page" style={{ maxWidth: 1100 }}>
      <div className="sb-meta" style={{ marginBottom: 8 }}>
        <Link href="/shipments" className="sb-rowlink">Shipments</Link> / {data.draft.shipmentNumber} / Edit
      </div>
      <h1 className="sb-h1">Edit shipment</h1>
      <p className="sb-meta" style={{ marginTop: 5, marginBottom: 16 }}>
        Changes to declaration value, date, weight, or landed-cost charges invalidate the previous calculation.
      </p>
      <ShipmentEditForm shipmentId={id} initial={data.draft} options={data.options} />
    </div>
  )
}
