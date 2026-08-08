/**
 * Machine check for the worked example in SKILL.md (submit-calculations-and-money).
 *
 * Runs the REAL engine (src/lib/calculations/duty-calculator.ts) against the
 * skill's worked example and asserts every published number. If this script
 * fails, the SKILL.md example is stale — fix the doc, not the engine.
 *
 * Run from the repo root:
 *   npx tsx .claude/skills/submit-calculations-and-money/scripts/verify-example.ts
 *
 * Exits 0 on success, 1 on any mismatch.
 */
import { calculateShipment } from '../../../../src/lib/calculations/duty-calculator'

const result = calculateShipment(
  [
    {
      id: 'perfume',
      totalValue: '240.00',
      quantity: '12',
      rates: {
        dutyBasis: 'COMPOUND',
        dutyRate: '0.30',
        specificRate: '5.00',
        vatRate: '0.10',
        levyRate: '0.01',
        exciseRate: '0.05',
      },
    },
    {
      id: 'misc',
      totalValue: '119.99',
      quantity: '2',
      rates: {
        dutyBasis: 'AD_VALOREM',
        dutyRate: '0.20',
        specificRate: null,
        vatRate: '0.10',
        levyRate: '0',
        exciseRate: '0',
      },
    },
  ],
  { freightCharge: '75.55', insuranceCharge: '0', otherCharges: '0' },
)

const expected: Record<string, string> = {
  'perfume.freightApportioned': '50.37',
  'perfume.cifValue': '290.37',
  'perfume.dutyAmount': '87.11',
  'perfume.exciseAmount': '14.52',
  'perfume.levyAmount': '2.90',
  'perfume.vatAmount': '39.49',
  'misc.freightApportioned': '25.18',
  'misc.cifValue': '145.17',
  'misc.dutyAmount': '29.03',
  'misc.vatAmount': '17.42',
  totalFobValue: '359.99',
  totalCifValue: '435.54',
  totalDuty: '116.14',
  totalExcise: '14.52',
  totalLevy: '2.90',
  totalVat: '57.91',
  processingFee: '10.00',
  totalPayable: '201.47',
}

const actual: Record<string, string> = {
  totalFobValue: result.totalFobValue.toFixed(2),
  totalCifValue: result.totalCifValue.toFixed(2),
  totalDuty: result.totalDuty.toFixed(2),
  totalExcise: result.totalExcise.toFixed(2),
  totalLevy: result.totalLevy.toFixed(2),
  totalVat: result.totalVat.toFixed(2),
  processingFee: result.processingFee.toFixed(2),
  totalPayable: result.totalPayable.toFixed(2),
}
for (const line of result.lines) {
  actual[`${line.id}.freightApportioned`] = line.freightApportioned.toFixed(2)
  actual[`${line.id}.cifValue`] = line.cifValue.toFixed(2)
  actual[`${line.id}.dutyAmount`] = line.dutyAmount.toFixed(2)
  actual[`${line.id}.exciseAmount`] = line.exciseAmount.toFixed(2)
  actual[`${line.id}.levyAmount`] = line.levyAmount.toFixed(2)
  actual[`${line.id}.vatAmount`] = line.vatAmount.toFixed(2)
}

let failures = 0
for (const [key, want] of Object.entries(expected)) {
  const got = actual[key]
  if (got !== want) {
    failures += 1
    console.error(`MISMATCH ${key}: expected ${want}, got ${got}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} mismatch(es) — SKILL.md worked example is out of sync with the engine.`)
  process.exit(1)
}
console.log('verify-example: all 18 published numbers match the engine. OK')
