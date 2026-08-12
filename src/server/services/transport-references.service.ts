/**
 * Global transport reference directory used by every brokerage.
 *
 * These records deliberately use the unscoped Prisma client because Carrier,
 * Port, Vessel, Journey, Voyage and ShippingAgent are shared reference models,
 * not tenant-owned business data. The authenticated Server Actions remain the
 * permission boundary; this service owns consistency checks and audit writes.
 */
import { writeAudit, type AuditContext } from '@/lib/audit'
import { basePrisma } from '@/lib/db/prisma'
import type { TenantClient } from '@/lib/db/tenant-client'
import { BusinessRuleError, ConflictError } from '@/lib/errors'

type SeaOrAir = 'SEA' | 'AIR'

interface VesselCreateInput {
  carrierId: string
  name: string
  mode: SeaOrAir
  imoNumber?: string
}

interface JourneyCreateInput {
  originPortId: string
  destinationPortId: string
}

interface VoyageCreateInput {
  vesselId: string
  journeyId?: string
  voyageNumber: string
  departureDate?: Date
  arrivalDate?: Date
}

interface ShippingAgentCreateInput {
  name: string
  code?: string
  email?: string
  phone?: string
}

function isUniqueConstraint(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002'
}

export const transportReferencesService = {
  async listVoyages() {
    return basePrisma.voyage.findMany({
      select: {
        id: true,
        voyageNumber: true,
        arrivalDate: true,
        vessel: { select: { name: true } },
        journey: {
          select: {
            originPort: { select: { unLocode: true } },
            destinationPort: { select: { unLocode: true } },
          },
        },
      },
      orderBy: { arrivalDate: 'desc' },
      take: 50,
    })
  },

  async listShippingAgents() {
    return basePrisma.shippingAgent.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  },

  async listDirectory() {
    const [carriers, ports, vessels, journeys] = await Promise.all([
      basePrisma.carrier.findMany({
        where: { isActive: true, mode: { in: ['SEA', 'AIR'] } },
        select: { id: true, name: true, code: true, mode: true },
        orderBy: { name: 'asc' },
      }),
      basePrisma.port.findMany({
        where: { isActive: true },
        select: { id: true, unLocode: true, name: true, country: true },
        orderBy: { unLocode: 'asc' },
      }),
      basePrisma.vessel.findMany({
        where: { isActive: true, mode: { in: ['SEA', 'AIR'] } },
        select: { id: true, name: true, mode: true, carrier: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      basePrisma.journey.findMany({
        select: {
          id: true,
          originPort: { select: { unLocode: true, name: true } },
          destinationPort: { select: { unLocode: true, name: true } },
        },
        orderBy: { originPort: { unLocode: 'asc' } },
      }),
    ])
    return { carriers, ports, vessels, journeys }
  },

  async createShippingAgent(db: TenantClient, audit: AuditContext, data: ShippingAgentCreateInput) {
    try {
      const agent = await basePrisma.shippingAgent.create({
        data,
        select: { id: true, name: true },
      })
      await writeAudit(db, audit, {
        action: 'CREATE',
        entityType: 'ShippingAgentReference',
        entityId: agent.id,
        changes: { after: data },
      })
      return agent
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictError(`Shipping agent code "${data.code}" is already in use.`)
      }
      throw error
    }
  },

  async createVessel(db: TenantClient, audit: AuditContext, data: VesselCreateInput) {
    const carrier = await basePrisma.carrier.findUnique({
      where: { id: data.carrierId },
      select: { id: true, name: true, mode: true, isActive: true },
    })
    if (!carrier?.isActive) throw new BusinessRuleError('Select an active carrier.')
    if (carrier.mode !== data.mode) {
      throw new BusinessRuleError(`${carrier.name} is configured for ${carrier.mode.toLowerCase()} transport, not ${data.mode.toLowerCase()}.`)
    }

    const createData = {
      carrierId: data.carrierId,
      name: data.name,
      mode: data.mode,
      imoNumber: data.mode === 'SEA' ? data.imoNumber : undefined,
    }
    try {
      const vessel = await basePrisma.vessel.create({
        data: createData,
        select: { id: true, name: true, mode: true, carrier: { select: { name: true } } },
      })
      await writeAudit(db, audit, {
        action: 'CREATE',
        entityType: 'VesselReference',
        entityId: vessel.id,
        changes: { after: createData },
      })
      return vessel
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictError(`IMO number "${data.imoNumber}" is already in use.`)
      }
      throw error
    }
  },

  async createJourney(db: TenantClient, audit: AuditContext, data: JourneyCreateInput) {
    if (data.originPortId === data.destinationPortId) {
      throw new BusinessRuleError('Origin and destination ports must be different.')
    }
    const ports = await basePrisma.port.findMany({
      where: { id: { in: [data.originPortId, data.destinationPortId] }, isActive: true },
      select: { id: true },
    })
    if (ports.length !== 2) throw new BusinessRuleError('Select two active ports.')

    try {
      const journey = await basePrisma.journey.create({
        data,
        select: {
          id: true,
          originPort: { select: { unLocode: true } },
          destinationPort: { select: { unLocode: true } },
        },
      })
      await writeAudit(db, audit, {
        action: 'CREATE',
        entityType: 'JourneyReference',
        entityId: journey.id,
        changes: { after: data },
      })
      return journey
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ConflictError('That route already exists.')
      throw error
    }
  },

  async createVoyage(db: TenantClient, audit: AuditContext, data: VoyageCreateInput) {
    const vessel = await basePrisma.vessel.findUnique({
      where: { id: data.vesselId },
      select: { id: true, isActive: true, mode: true },
    })
    if (!vessel?.isActive || !['SEA', 'AIR'].includes(vessel.mode)) {
      throw new BusinessRuleError('Select an active sea vessel or aircraft.')
    }
    if (data.journeyId) {
      const journey = await basePrisma.journey.findUnique({
        where: { id: data.journeyId },
        select: { id: true },
      })
      if (!journey) throw new BusinessRuleError('Select an existing route.')
    }

    try {
      const voyage = await basePrisma.voyage.create({
        data,
        select: {
          id: true,
          voyageNumber: true,
          arrivalDate: true,
          vessel: { select: { name: true } },
          journey: {
            select: {
              originPort: { select: { unLocode: true } },
              destinationPort: { select: { unLocode: true } },
            },
          },
        },
      })
      await writeAudit(db, audit, {
        action: 'CREATE',
        entityType: 'VoyageReference',
        entityId: voyage.id,
        changes: { after: data },
      })
      return voyage
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictError(`Voyage "${data.voyageNumber}" already exists for that vessel or aircraft.`)
      }
      throw error
    }
  },
}
