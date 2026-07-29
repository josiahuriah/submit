/**
 * End-to-end smoke: exercises the real services against seeded data.
 *   1. calculate SHP-2026-00001 (rum SPECIFIC + t-shirts AD_VALOREM + fridge w/ levy)
 *   2. verify duty math spot checks
 *   3. submit via mock BEAIP
 *   4. confirm CustomsEntry recorded and shipment flipped to SUBMITTED
 * Then resets the shipment back to DRAFT so the script is re-runnable.
 */
import 'dotenv/config'
import { basePrisma } from '../src/lib/db/prisma'
import { createTenantClient } from '../src/lib/db/tenant-client'
import { calculationsService } from '../src/server/services/calculations.service'
import { declarationsService } from '../src/server/services/declarations.service'

async function main() {
  const org = await basePrisma.organization.findUniqueOrThrow({ where: { slug: 'bahama-brokerage' } })
  const user = await basePrisma.user.findUniqueOrThrow({ where: { email: 'broker@bahamabrokerage.test' } })
  const db = createTenantClient(org.id)
  const audit = { organizationId: org.id, userId: user.id }

  const shipment = await db.shipment.findFirst({
    where: { shipmentNumber: 'SHP-2026-00001' },
    select: { id: true, status: true },
  })
  if (!shipment) throw new Error('Seed shipment missing')

  // Make re-runnable: reset to DRAFT and clear old entries.
  await basePrisma.customsEntry.deleteMany({ where: { shipmentId: shipment.id } })
  await basePrisma.shipment.update({
    where: { id: shipment.id },
    data: { status: 'DRAFT', submittedAt: null, calculatedAt: null },
  })

  console.log('1) Calculating...')
  const calc = await calculationsService.calculate(db, audit, shipment.id, {
    apportionmentBasis: 'VALUE',
  })
  console.table(calc.totals)

  // Spot checks:
  // Line 1 rum — 600 L × $10/L specific duty = $6,000 duty regardless of value.
  const rumLine = calc.lines[0]!
  console.log(`   Rum duty (expect 6000.00): ${rumLine.dutyAmount}`)
  if (rumLine.dutyAmount !== '6000.00') throw new Error('SPECIFIC duty check failed')

  // Charges apportioned must sum exactly to 1850+320+145 = 2315.00 across CIFs:
  // totalCif - totalFob should equal 2315.00
  const cifMinusFob = (Number(calc.totals.totalCifValue) - Number(calc.totals.totalFobValue)).toFixed(2)
  console.log(`   CIF − FOB (expect 2315.00): ${cifMinusFob}`)
  if (cifMinusFob !== '2315.00') throw new Error('Apportionment exactness check failed')

  console.log('2) Submitting to BEAIP (mock)...')
  const result = await declarationsService.submit(db, audit, shipment.id, 'C13')
  console.log(`   ${result.message}`)
  console.log(`   Entry status: ${result.entry.status}, ref: ${result.entry.beaipReference}`)

  const after = await db.shipment.findUnique({
    where: { id: shipment.id },
    select: { status: true, submittedAt: true },
  })
  console.log(`   Shipment status: ${after?.status} at ${after?.submittedAt?.toISOString()}`)
  if (after?.status !== 'SUBMITTED') throw new Error('Status transition failed')

  // Reset for next run / UI demo.
  await basePrisma.shipment.update({
    where: { id: shipment.id },
    data: { status: 'DRAFT', submittedAt: null },
  })
  console.log('\n✓ Smoke passed (shipment reset to DRAFT for demo use)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => basePrisma.$disconnect())
