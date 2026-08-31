/**
 * Tenant isolation integration tests — run against the real local Postgres
 * (uses the dev seed's two organizations).
 *
 * What's proven here:
 *   1. A tenant client only sees its own org's rows (same shipmentNumber
 *      exists in both orgs — each client sees exactly one).
 *   2. findUnique by a foreign org's id returns null (extendedWhereUnique
 *      injection works).
 *   3. Creates are auto-stamped with the client's organizationId.
 *   4. Cross-tenant updates by id fail (no row matched).
 *
 * Note: the RLS backstop itself can't be proven on local Postgres because
 * the local role is a superuser (RLS is bypassed). On Neon, neondb_owner is
 * NOT a superuser and FORCE ROW LEVEL SECURITY applies. These tests prove
 * Layer 1 (the Prisma extension), which is the primary enforcement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { basePrisma } from '@/lib/db/prisma'
import { createTenantClient } from '@/lib/db/tenant-client'

let org1Id: string
let org2Id: string

beforeAll(async () => {
  const org1 = await basePrisma.organization.findUnique({ where: { slug: 'bahama-brokerage' } })
  const org2 = await basePrisma.organization.findUnique({ where: { slug: 'island-customs' } })
  if (!org1 || !org2) {
    throw new Error('Dev seed missing — run `npm run db:seed && npm run db:seed:dev` first')
  }
  org1Id = org1.id
  org2Id = org2.id
})

afterAll(async () => {
  // Clean up anything this test created.
  await basePrisma.client.deleteMany({ where: { name: 'ISOLATION-TEST-CLIENT' } })
  await basePrisma.$disconnect()
})

describe('tenant client isolation (Layer 1: Prisma extension)', () => {
  it('each org sees only its own shipments despite identical shipmentNumbers', async () => {
    const db1 = createTenantClient(org1Id)
    const db2 = createTenantClient(org2Id)

    const org1Shipments = await db1.shipment.findMany({ where: { shipmentNumber: 'SHP-2026-00001' } })
    const org2Shipments = await db2.shipment.findMany({ where: { shipmentNumber: 'SHP-2026-00001' } })

    expect(org1Shipments).toHaveLength(1)
    expect(org2Shipments).toHaveLength(1)
    expect(org1Shipments[0]!.organizationId).toBe(org1Id)
    expect(org2Shipments[0]!.organizationId).toBe(org2Id)
    expect(org1Shipments[0]!.id).not.toBe(org2Shipments[0]!.id)
  })

  it('findUnique by a foreign org id returns null', async () => {
    const db1 = createTenantClient(org1Id)
    const db2 = createTenantClient(org2Id)

    const org2Shipment = await db2.shipment.findFirst({ select: { id: true } })
    expect(org2Shipment).not.toBeNull()

    const leaked = await db1.shipment.findUnique({ where: { id: org2Shipment!.id } })
    expect(leaked).toBeNull()
  })

  it('creates are auto-stamped with the tenant organizationId', async () => {
    const db1 = createTenantClient(org1Id)
    const created = await db1.client.create({
      data: { name: 'ISOLATION-TEST-CLIENT', clientType: 'BUSINESS' } as never,
    })
    expect(created.organizationId).toBe(org1Id)
  })

  it('cross-tenant update by id throws (record not found within scope)', async () => {
    const db1 = createTenantClient(org1Id)
    const db2 = createTenantClient(org2Id)

    const org2Shipment = await db2.shipment.findFirst({ select: { id: true } })
    await expect(
      db1.shipment.update({
        where: { id: org2Shipment!.id },
        data: { description: 'should never apply' },
      }),
    ).rejects.toThrow()
  })

  it('counts are scoped', async () => {
    const db2 = createTenantClient(org2Id)
    const total = await basePrisma.shipment.count()
    const scoped = await db2.shipment.count()
    expect(scoped).toBeLessThan(total)
  })

  it('isolates submission batches and attempts, including creates and updates', async () => {
    const db1 = createTenantClient(org1Id)
    const db2 = createTenantClient(org2Id)
    const shipment = await db1.shipment.findFirstOrThrow({ select: { id: true } })
    const user = await db1.user.findFirstOrThrow({ select: { id: true } })
    const marker = randomUUID()
    const batch = await db1.customsSubmissionBatch.create({
      data: { organizationId: org2Id, shipmentId: shipment.id, createdById: user.id, declarationCount: 1 },
    })
    try {
      expect(batch.organizationId).toBe(org1Id)
      const entry = await db1.customsEntry.create({
        data: {
          organizationId: org1Id, shipmentId: shipment.id, submissionBatchId: batch.id,
          declarationType: 'C13', declarationGroupCode: '400', declarationSequence: 1,
          functionalReferenceId: marker, brokerReference: marker, declarationHash: 'isolation-test-only',
        },
      })
      const attempt = await db1.customsSubmissionAttempt.create({
        data: { organizationId: org2Id, customsEntryId: entry.id, attemptNumber: 1, messageId: marker, declarationHash: 'isolation-test-only' },
      })
      expect(attempt.organizationId).toBe(org1Id)
      expect(await db2.customsSubmissionBatch.findUnique({ where: { id: batch.id } })).toBeNull()
      expect(await db2.customsSubmissionAttempt.findUnique({ where: { id: attempt.id } })).toBeNull()
      await expect(db2.customsSubmissionBatch.update({ where: { id: batch.id }, data: { declarationCount: 2 } })).rejects.toThrow()
      await expect(db2.customsSubmissionAttempt.update({ where: { id: attempt.id }, data: { outcome: 'UNKNOWN' } })).rejects.toThrow()
    } finally {
      await db1.customsSubmissionAttempt.deleteMany({ where: { customsEntry: { submissionBatchId: batch.id } } })
      await db1.customsEntry.deleteMany({ where: { submissionBatchId: batch.id } })
      await db1.customsSubmissionBatch.delete({ where: { id: batch.id } })
    }
  })
})
