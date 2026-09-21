import type { TenantClient } from '@/lib/db/tenant-client'
import { allocateLineWeights } from '@/lib/calculations/line-weights'
import { d } from '@/lib/calculations/money'

/** Refresh weights independently of tax calculation (which may fail for an unverified rate). */
export async function refreshLineWeights(db: TenantClient, shipmentId: string) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: { status: true, grossWeightLb: true, netWeightLb: true },
  })
  if (!shipment || shipment.status !== 'DRAFT') return
  const lines = await db.lineItem.findMany({
    where: { invoice: { shipmentId } },
    select: { id: true, totalValue: true },
    orderBy: [{ invoice: { createdAt: 'asc' } }, { invoiceId: 'asc' }, { lineNumber: 'asc' }],
  })
  if (!lines.length) return
  const gross = d(shipment.grossWeightLb).greaterThan(0)
    ? allocateLineWeights(String(shipment.grossWeightLb), lines) : []
  const net = shipment.netWeightLb === null ? []
    : allocateLineWeights(String(shipment.netWeightLb), lines, true)
  const grossById = new Map(gross.map((line) => [line.id, line.weightLb]))
  const netById = new Map(net.map((line) => [line.id, line.weightLb]))
  await db.$tenantTransaction(async (tx) => {
    for (const line of lines) {
      await tx.lineItem.update({ where: { id: line.id }, data: {
        weightLb: grossById.get(line.id) ?? null,
        netWeightLb: netById.get(line.id) ?? null,
      } })
    }
  })
}
