/**
 * End-to-end smoke: exercises the real services against seeded data.
 *   1. calculate SHP-2026-00001 (rum excise + t-shirts ad valorem + fridge levy)
 *   2. verify duty math spot checks
 *   3. generate the Customs-reviewable TFP XML artifact
 *   4. confirm the artifact is recorded without submitting/changing status
 */
import 'dotenv/config'
import { basePrisma } from '../src/lib/db/prisma'
import { createTenantClient } from '../src/lib/db/tenant-client'
import { calculationsService } from '../src/server/services/calculations.service'
import { declarationArtifactsService } from '../src/server/services/declaration-artifacts.service'
import { d } from '../src/lib/calculations/money'

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
  // Line 1 rum — 600 L × 0.22 = 132 imperial gallons × $13 current excise.
  const rumLine = calc.lines[0]!
  console.log(`   Rum excise (expect 1716.00): ${rumLine.exciseAmount}`)
  if (rumLine.exciseAmount !== '1716.00' || rumLine.dutyAmount !== '0.00') {
    throw new Error('Specific alcohol excise check failed')
  }

  // Charges apportioned must sum exactly to 1850+320+145 = 2315.00 across CIFs:
  // totalCif - totalFob should equal 2315.00
  const cifMinusFob = d(calc.totals.totalCifValue).minus(calc.totals.totalFobValue).toFixed(2)
  console.log(`   CIF − FOB (expect 2315.00): ${cifMinusFob}`)
  if (cifMinusFob !== '2315.00') throw new Error('Apportionment exactness check failed')

  console.log('2) Generating Customs-review XML (no endpoint call)...')
  const result = await declarationArtifactsService.generate(db, audit, shipment.id, {
    declarationType: 'C13',
  })
  console.log(`   ${result.fileName}`)
  console.log(`   Artifact status: ${result.artifact.status}`)

  const after = await db.shipment.findUnique({
    where: { id: shipment.id },
    select: { status: true, submittedAt: true },
  })
  console.log(`   Shipment status: ${after?.status}`)
  if (after?.status !== 'DRAFT' || after.submittedAt !== null) {
    throw new Error('Review artifact must not submit or advance the shipment')
  }
  console.log('\n✓ Smoke passed (review XML generated; no Customs endpoint called)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => basePrisma.$disconnect())
