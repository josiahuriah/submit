/**
 * Generate a TFB_WCO_DEC v1.4.4 declaration XML from a calculated shipment
 * and validate it against docs/tfp/TFB_WCO_DEC_v1.4.4.xsd — the deliverable
 * for the TFP Single Window "sample-file gate" (integration steps 2–3).
 *
 * Usage:
 *   npx tsx scripts/generate-wco-declaration.ts [shipmentNumber] [orgSlug]
 *
 * Defaults to the dev-seed demo shipment (SHP-2026-00001, bahama-brokerage).
 * The shipment must have a current calculation — apportioned line costs are
 * engine output; run the calculation (or scripts/smoke.ts) first.
 *
 * Output: docs/tfp/generated/declaration-<shipmentNumber>.xml
 * Validation needs xmllint (ships with macOS); skipped with a warning if absent.
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { basePrisma } from '../src/lib/db/prisma'
import { createTenantClient } from '../src/lib/db/tenant-client'
import { buildWcoDeclarationXml } from '../src/lib/beaip'
import {
  loadDeclarationSource,
  toBeaipDeclaration,
} from '../src/server/services/declaration-mapper'

const XSD_PATH = path.join(process.cwd(), 'docs', 'tfp', 'TFB_WCO_DEC_v1.4.4.xsd')

export function validateWcoXml(xmlPath: string): { ok: boolean; detail: string } {
  const probe = spawnSync('xmllint', ['--version'], { encoding: 'utf8' })
  if (probe.error) {
    return { ok: false, detail: 'xmllint not found — validation skipped (brew install libxml2)' }
  }
  const res = spawnSync('xmllint', ['--noout', '--schema', XSD_PATH, xmlPath], {
    encoding: 'utf8',
  })
  const detail = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()
  return { ok: res.status === 0, detail }
}

async function main() {
  const shipmentNumber = process.argv[2] ?? 'SHP-2026-00001'
  const orgSlug = process.argv[3] ?? 'bahama-brokerage'

  const org = await basePrisma.organization.findUniqueOrThrow({ where: { slug: orgSlug } })
  const db = createTenantClient(org.id)

  const stub = await db.shipment.findFirst({
    where: { shipmentNumber },
    select: { id: true },
  })
  if (!stub) throw new Error(`Shipment ${shipmentNumber} not found in org ${orgSlug}`)

  const source = await loadDeclarationSource(db, stub.id)
  if (!source) throw new Error(`Shipment ${shipmentNumber} not found in org ${orgSlug}`)
  if (!source.calculatedAt) {
    throw new Error(
      `Shipment ${shipmentNumber} has no calculation — run the duty calculation ` +
        `(or "npx tsx scripts/smoke.ts") first; apportioned costs are engine output.`,
    )
  }

  const declaration = toBeaipDeclaration(source, 'C13')
  const xml = buildWcoDeclarationXml(declaration)

  const outDir = path.join(process.cwd(), 'docs', 'tfp', 'generated')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `declaration-${shipmentNumber}.xml`)
  writeFileSync(outPath, xml, 'utf8')
  console.log(`✓ wrote ${path.relative(process.cwd(), outPath)}`)
  console.log(
    `  ${declaration.lines.length} goods item(s), ${declaration.invoices.length} invoice(s), ` +
      `office ${declaration.customsOfficeCode}, regime ${declaration.regimeCode} (placeholder)`,
  )

  const result = validateWcoXml(outPath)
  if (result.ok) {
    console.log(`✓ schema validation passed (${path.basename(XSD_PATH)} + common-types stub)`)
  } else {
    console.error(`✗ schema validation: ${result.detail}`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => basePrisma.$disconnect())
