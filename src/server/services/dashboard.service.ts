/**
 * Operational dashboard read model.
 *
 * This service performs tenant-scoped aggregate reads once so the Home page
 * can show workload and receivables without reproducing business queries in
 * presentation components.
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { d, moneyString } from '@/lib/calculations/money'

export const dashboardService = {
  async get(db: TenantClient) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [shipmentGroups, activeClients, activeSuppliers, openManifests, artifactCount, billing, overdueInvoices, recentShipments] = await Promise.all([
      db.shipment.groupBy({ by: ['status'], _count: { _all: true } }),
      db.client.count({ where: { isActive: true } }),
      db.supplier.count({ where: { isActive: true } }),
      db.manifest.count({ where: { status: 'OPEN' } }),
      db.customsEntry.count(),
      db.brokerageInvoice.aggregate({
        where: { status: { not: 'VOID' } },
        _sum: { total: true, amountPaid: true },
      }),
      db.brokerageInvoice.count({
        where: {
          status: { in: ['SENT', 'PARTIALLY_PAID'] },
          dueDate: { lt: today },
        },
      }),
      db.shipment.findMany({
        select: {
          id: true,
          shipmentNumber: true,
          blNumber: true,
          status: true,
          calculatedAt: true,
          totalPayable: true,
          client: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
    ])

    const shipmentCounts = Object.fromEntries(shipmentGroups.map((group) => [group.status, group._count._all]))
    const billed = d(String(billing._sum.total ?? 0))
    const paid = d(String(billing._sum.amountPaid ?? 0))

    return {
      counts: {
        draftShipments: shipmentCounts.DRAFT ?? 0,
        submittedShipments: shipmentCounts.SUBMITTED ?? 0,
        clearedShipments: shipmentCounts.CLEARED ?? 0,
        activeClients,
        activeSuppliers,
        openManifests,
        reviewArtifacts: artifactCount,
        overdueInvoices,
      },
      receivables: {
        billed: moneyString(billed),
        paid: moneyString(paid),
        outstanding: moneyString(billed.minus(paid)),
      },
      recentShipments: recentShipments.map((shipment) => ({
        id: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        blNumber: shipment.blNumber ?? '—',
        clientName: shipment.client.name,
        status: shipment.status,
        calculated: shipment.calculatedAt !== null,
        totalPayable: moneyString(String(shipment.totalPayable)),
      })),
    }
  },
}
