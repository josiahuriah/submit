/**
 * Reference-data seed (committed to version control).
 *
 * Seeds GLOBAL lookup data only — customs offices, ports, carriers, shipping
 * agents, and HS codes with current rates. No tenant data lives here (see
 * seed.dev.ts for gitignored development fixtures).
 *
 * HS codes: seeds from prisma/data/hs-codes.json when present (the full
 * 1,544-code extraction from the 2023 Bahamas Tariff Schedule); otherwise
 * falls back to the representative subset below, which covers every duty
 * basis the calculation engine supports — including SPECIFIC-rate alcohol
 * lines, the accuracy gap that differentiates Submit from CayDeclarations.
 *
 * Idempotent: every write is an upsert keyed on natural identifiers, so
 * `npm run db:seed` can run repeatedly.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import {
  EXCISABLE_CHAPTERS,
  TARIFF_EDITION,
  normalizeTariffFile,
  type RawTariffRecord,
} from './tariff-import'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

// --- Customs offices -----------------------------------------------------------

const CUSTOMS_OFFICES = [
  { code: 'NAS', name: 'Nassau', location: 'New Providence' },
  { code: 'FPO', name: 'Freeport', location: 'Grand Bahama' },
  { code: 'MSH', name: 'Marsh Harbour', location: 'Abaco' },
  { code: 'GGT', name: "George Town", location: 'Exuma' },
  { code: 'NEH', name: 'North Eleuthera', location: 'Eleuthera' },
]

// --- Ports -----------------------------------------------------------------------

// Bahamian ports of discharge plus the origin ports that actually appear on
// Bahamian import manifests: the South Florida trio carries the bulk of the
// trade, then the US east-coast/gulf feeders, the transhipment hubs, and the
// far-east load ports that show up on containerized consolidations.
const PORTS = [
  // --- Bahamas (discharge) ---
  { unLocode: 'BSNAS', name: 'Nassau (Arawak Port)', country: 'BS' },
  { unLocode: 'BSFPO', name: 'Freeport Harbour', country: 'BS' },
  { unLocode: 'BSMHH', name: 'Marsh Harbour', country: 'BS' },
  { unLocode: 'BSGGT', name: 'George Town, Exuma', country: 'BS' },
  { unLocode: 'BSELH', name: 'North Eleuthera', country: 'BS' },
  { unLocode: 'BSGHB', name: 'Governor’s Harbour', country: 'BS' },
  { unLocode: 'BSTCB', name: 'Treasure Cay', country: 'BS' },
  { unLocode: 'BSCCZ', name: 'Chub Cay', country: 'BS' },
  { unLocode: 'BSSAQ', name: 'San Andros', country: 'BS' },
  // --- United States (origin) ---
  { unLocode: 'USPEF', name: 'Port Everglades', country: 'US' },
  { unLocode: 'USMIA', name: 'Miami', country: 'US' },
  { unLocode: 'USPBI', name: 'Port of Palm Beach', country: 'US' },
  { unLocode: 'USJAX', name: 'Jacksonville', country: 'US' },
  { unLocode: 'USSAV', name: 'Savannah', country: 'US' },
  { unLocode: 'USCHS', name: 'Charleston', country: 'US' },
  { unLocode: 'USHOU', name: 'Houston', country: 'US' },
  { unLocode: 'USNYC', name: 'New York', country: 'US' },
  { unLocode: 'USORF', name: 'Norfolk', country: 'US' },
  { unLocode: 'USTPA', name: 'Tampa', country: 'US' },
  { unLocode: 'USLAX', name: 'Los Angeles', country: 'US' },
  // --- Regional transhipment hubs ---
  { unLocode: 'PAONX', name: 'Colón', country: 'PA' },
  { unLocode: 'JMKIN', name: 'Kingston', country: 'JM' },
  { unLocode: 'DOCAU', name: 'Caucedo', country: 'DO' },
  { unLocode: 'TTPOS', name: 'Port of Spain', country: 'TT' },
  // --- Far East / Europe load ports ---
  { unLocode: 'CNSHA', name: 'Shanghai', country: 'CN' },
  { unLocode: 'CNNGB', name: 'Ningbo', country: 'CN' },
  { unLocode: 'CNYTN', name: 'Yantian', country: 'CN' },
  { unLocode: 'HKHKG', name: 'Hong Kong', country: 'HK' },
  { unLocode: 'NLRTM', name: 'Rotterdam', country: 'NL' },
  { unLocode: 'GBFXT', name: 'Felixstowe', country: 'GB' },
]

// --- Carriers & agents --------------------------------------------------------------

const CARRIERS = [
  { code: 'TROP', name: 'Tropical Shipping', mode: 'SEA' },
  { code: 'CROW', name: 'Crowley Maritime', mode: 'SEA' },
  { code: 'MSCU', name: 'MSC Mediterranean Shipping', mode: 'SEA' },
  { code: 'BAHA', name: 'Bahamasair Cargo', mode: 'AIR' },
]

const SHIPPING_AGENTS = [
  { code: 'TSA-NAS', name: 'Tropical Shipping Agency (Nassau)' },
  { code: 'IEB', name: 'Import Export Brokers Ltd' },
  { code: 'BMS', name: 'Bahamas Maritime Services' },
]

// --- Representative HS subset -----------------------------------------------------------
// rate fractions: 0.45 = 45%. specificRate in BSD per specificRateUnit.

interface SeedHsCode {
  code: string
  description: string
  unit?: string
  chapterName?: string
  sectionNumber?: string
  sectionName?: string
  requiresPermit?: boolean
  permitType?: string
  rate: {
    dutyBasis?: 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND'
    dutyRate?: string
    specificRate?: string
    specificRateUnit?: string
    vatRate?: string
    levyRate?: string
    exciseRate?: string
  }
}

const HS_SUBSET: SeedHsCode[] = [
  // Ch. 02–21 — foodstuffs
  { code: '0201.10.00', description: 'Beef carcasses and half-carcasses, fresh or chilled', unit: 'KG', chapterName: 'Meat', rate: { dutyRate: '0' } },
  { code: '0207.14.00', description: 'Chicken cuts and offal, frozen', unit: 'KG', chapterName: 'Meat', rate: { dutyRate: '0' } },
  { code: '0402.10.00', description: 'Milk powder, fat content ≤ 1.5%', unit: 'KG', chapterName: 'Dairy produce', rate: { dutyRate: '0.05' } },
  { code: '1006.30.00', description: 'Semi-milled or wholly milled rice', unit: 'KG', chapterName: 'Cereals', rate: { dutyRate: '0' } },
  { code: '1905.31.00', description: 'Sweet biscuits', unit: 'KG', chapterName: 'Preparations of cereals', rate: { dutyRate: '0.10' } },
  { code: '2009.11.00', description: 'Orange juice, frozen', unit: 'L', chapterName: 'Beverages, juices', rate: { dutyRate: '0.30' } },

  // Ch. 22 — alcohol: SPECIFIC and COMPOUND duty bases (the differentiator)
  { code: '2203.00.10', description: 'Beer made from malt, in bottles or cans', unit: 'L', chapterName: 'Beverages, spirits and vinegar', rate: { dutyBasis: 'SPECIFIC', specificRate: '2.00', specificRateUnit: 'L', dutyRate: '0' } },
  { code: '2204.10.00', description: 'Sparkling wine', unit: 'L', chapterName: 'Beverages, spirits and vinegar', rate: { dutyBasis: 'SPECIFIC', specificRate: '5.00', specificRateUnit: 'L', dutyRate: '0' } },
  { code: '2204.21.00', description: 'Wine of fresh grapes, in containers ≤ 2L', unit: 'L', chapterName: 'Beverages, spirits and vinegar', rate: { dutyBasis: 'SPECIFIC', specificRate: '3.00', specificRateUnit: 'L', dutyRate: '0' } },
  { code: '2208.30.00', description: 'Whiskies', unit: 'L', chapterName: 'Beverages, spirits and vinegar', rate: { dutyBasis: 'SPECIFIC', specificRate: '12.00', specificRateUnit: 'L', dutyRate: '0' } },
  { code: '2208.40.00', description: 'Rum and other spirits from sugar-cane products', unit: 'L', chapterName: 'Beverages, spirits and vinegar', rate: { dutyBasis: 'SPECIFIC', specificRate: '10.00', specificRateUnit: 'L', dutyRate: '0' } },
  { code: '2208.60.00', description: 'Vodka', unit: 'L', chapterName: 'Beverages, spirits and vinegar', rate: { dutyBasis: 'SPECIFIC', specificRate: '12.00', specificRateUnit: 'L', dutyRate: '0' } },

  // Ch. 24 — tobacco (compound example)
  { code: '2402.20.00', description: 'Cigarettes containing tobacco', unit: 'KG', chapterName: 'Tobacco', rate: { dutyBasis: 'COMPOUND', dutyRate: '2.20', specificRate: '260.00', specificRateUnit: 'KG', exciseRate: '0' } },

  // Ch. 27 — fuel
  { code: '2710.12.10', description: 'Motor gasoline', unit: 'L', chapterName: 'Mineral fuels', rate: { dutyBasis: 'SPECIFIC', specificRate: '1.06', specificRateUnit: 'L', dutyRate: '0' } },

  // Ch. 30–38 — pharma, cosmetics, cleaning
  { code: '3004.90.00', description: 'Medicaments, packaged for retail sale', unit: 'KG', chapterName: 'Pharmaceutical products', rate: { dutyRate: '0' } },
  { code: '3303.00.00', description: 'Perfumes and toilet waters', unit: 'PCS', chapterName: 'Cosmetics', rate: { dutyRate: '0.10' } },
  { code: '3305.10.00', description: 'Shampoos', unit: 'PCS', chapterName: 'Cosmetics', rate: { dutyRate: '0.10' } },
  { code: '3401.11.00', description: 'Toilet soap, for retail sale', unit: 'KG', chapterName: 'Soap and washing preparations', rate: { dutyRate: '0.05' } },
  { code: '3402.20.00', description: 'Washing and cleaning preparations, retail', unit: 'KG', chapterName: 'Soap and washing preparations', rate: { dutyRate: '0.05' } },

  // Ch. 39–40 — plastics, rubber
  { code: '3923.21.00', description: 'Sacks and bags of polymers of ethylene', unit: 'KG', chapterName: 'Plastics', rate: { dutyRate: '0.45', levyRate: '0.05' } },
  { code: '4011.10.00', description: 'New pneumatic tyres for motor cars', unit: 'PCS', chapterName: 'Rubber', rate: { dutyRate: '0.45', levyRate: '0.05' } },

  // Ch. 48–49 — paper, printed matter
  { code: '4818.10.00', description: 'Toilet paper', unit: 'KG', chapterName: 'Paper', rate: { dutyRate: '0.05' } },
  { code: '4901.99.00', description: 'Printed books', unit: 'PCS', chapterName: 'Printed matter', rate: { dutyRate: '0' } },

  // Ch. 61–64 — apparel, footwear
  { code: '6104.43.00', description: "Women's dresses of synthetic fibres, knitted", unit: 'PCS', chapterName: 'Apparel, knitted', rate: { dutyRate: '0.25' } },
  { code: '6109.10.00', description: 'T-shirts of cotton, knitted', unit: 'PCS', chapterName: 'Apparel, knitted', rate: { dutyRate: '0.25' } },
  { code: '6203.42.00', description: "Men's trousers of cotton", unit: 'PCS', chapterName: 'Apparel, not knitted', rate: { dutyRate: '0.25' } },
  { code: '6403.99.00', description: 'Footwear with leather uppers', unit: 'PR', chapterName: 'Footwear', rate: { dutyRate: '0.30' } },

  // Ch. 69–70, 73 — ceramics, glass, steel
  { code: '6910.10.00', description: 'Ceramic sinks, washbasins, baths of porcelain', unit: 'PCS', chapterName: 'Ceramic products', rate: { dutyRate: '0.35' } },
  { code: '7013.37.00', description: 'Glass drinking vessels', unit: 'PCS', chapterName: 'Glassware', rate: { dutyRate: '0.35' } },
  { code: '7308.90.00', description: 'Structures and parts of iron or steel', unit: 'KG', chapterName: 'Iron and steel articles', rate: { dutyRate: '0.10' } },

  // Ch. 84–85 — machinery, electronics
  { code: '8418.10.00', description: 'Combined refrigerator-freezers', unit: 'PCS', chapterName: 'Machinery', rate: { dutyRate: '0.30', levyRate: '0.05' } },
  { code: '8450.11.00', description: 'Fully-automatic washing machines ≤ 10kg', unit: 'PCS', chapterName: 'Machinery', rate: { dutyRate: '0.30', levyRate: '0.05' } },
  { code: '8471.30.00', description: 'Portable computers ≤ 10kg (laptops)', unit: 'PCS', chapterName: 'Machinery', rate: { dutyRate: '0' } },
  { code: '8517.13.00', description: 'Smartphones', unit: 'PCS', chapterName: 'Electrical machinery', rate: { dutyRate: '0' } },
  { code: '8528.72.00', description: 'Colour television reception apparatus', unit: 'PCS', chapterName: 'Electrical machinery', rate: { dutyRate: '0.35', levyRate: '0.05' } },

  // Ch. 87 — vehicles (excise territory)
  { code: '8703.22.00', description: 'Motor cars, 1000–1500cc', unit: 'PCS', chapterName: 'Vehicles', rate: { dutyRate: '0', exciseRate: '0.25', levyRate: '0.05' } },
  { code: '8703.23.10', description: 'Motor cars, 1500–2000cc', unit: 'PCS', chapterName: 'Vehicles', rate: { dutyRate: '0', exciseRate: '0.45', levyRate: '0.05' } },
  { code: '8703.24.00', description: 'Motor cars, over 3000cc', unit: 'PCS', chapterName: 'Vehicles', rate: { dutyRate: '0', exciseRate: '0.65', levyRate: '0.05' } },
  { code: '8711.20.00', description: 'Motorcycles, 50–250cc', unit: 'PCS', chapterName: 'Vehicles', rate: { dutyRate: '0.65' } },

  // Ch. 94–95 — furniture, toys
  { code: '9403.60.00', description: 'Wooden furniture', unit: 'PCS', chapterName: 'Furniture', rate: { dutyRate: '0.35' } },
  { code: '9503.00.00', description: 'Toys; scale models; puzzles', unit: 'PCS', chapterName: 'Toys and games', rate: { dutyRate: '0.25' } },

  // Permit-controlled examples
  { code: '0106.20.00', description: 'Live reptiles', unit: 'PCS', chapterName: 'Live animals', requiresPermit: true, permitType: 'Ministry of Agriculture', rate: { dutyRate: '0.10' } },
  { code: '9302.00.00', description: 'Revolvers and pistols', unit: 'PCS', chapterName: 'Arms and ammunition', requiresPermit: true, permitType: 'Royal Bahamas Police Force', rate: { dutyRate: '0.45' } },
]

const RATE_EFFECTIVE_FROM = TARIFF_EDITION.effectiveFrom

async function seedHsCode(entry: SeedHsCode) {
  const [chapterPart] = entry.code.split('.')
  const chapter = chapterPart!.slice(0, 2)
  const heading = chapterPart!

  const hsCode = await prisma.hSCode.upsert({
    where: { code: entry.code },
    update: {
      description: entry.description,
      unit: entry.unit,
      chapterName: entry.chapterName,
      requiresPermit: entry.requiresPermit ?? false,
      permitType: entry.permitType,
    },
    create: {
      code: entry.code,
      description: entry.description,
      chapter,
      heading,
      unit: entry.unit,
      chapterName: entry.chapterName,
      requiresPermit: entry.requiresPermit ?? false,
      permitType: entry.permitType,
    },
  })

  // One current rate per code: close nothing, upsert on (hsCodeId, effectiveFrom).
  const existing = await prisma.hSCodeRate.findFirst({
    where: { hsCodeId: hsCode.id, effectiveFrom: RATE_EFFECTIVE_FROM },
  })
  const rateData = {
    dutyBasis: entry.rate.dutyBasis ?? 'AD_VALOREM',
    dutyRate: entry.rate.dutyRate ?? '0',
    specificRate: entry.rate.specificRate ?? null,
    specificRateUnit: entry.rate.specificRateUnit ?? null,
    vatRate: entry.rate.vatRate ?? '0.10',
    levyRate: entry.rate.levyRate ?? '0',
    exciseRate: entry.rate.exciseRate ?? '0',
  } as const
  if (existing) {
    await prisma.hSCodeRate.update({ where: { id: existing.id }, data: rateData })
  } else {
    await prisma.hSCodeRate.create({
      data: {
        hsCodeId: hsCode.id,
        effectiveFrom: RATE_EFFECTIVE_FROM,
        effectiveTo: null,
        changeReason: TARIFF_EDITION.changeReason,
        ...rateData,
      },
    })
  }
}

async function main() {
  console.log('Seeding reference data...')

  for (const office of CUSTOMS_OFFICES) {
    await prisma.customsOffice.upsert({
      where: { code: office.code },
      update: { name: office.name, location: office.location },
      create: office,
    })
  }
  console.log(`  ✓ ${CUSTOMS_OFFICES.length} customs offices`)

  for (const port of PORTS) {
    await prisma.port.upsert({
      where: { unLocode: port.unLocode },
      update: { name: port.name, country: port.country },
      create: port,
    })
  }
  console.log(`  ✓ ${PORTS.length} ports`)

  for (const carrier of CARRIERS) {
    await prisma.carrier.upsert({
      where: { code: carrier.code },
      update: { name: carrier.name, mode: carrier.mode as never },
      create: carrier as never,
    })
  }
  console.log(`  ✓ ${CARRIERS.length} carriers`)

  for (const agent of SHIPPING_AGENTS) {
    await prisma.shippingAgent.upsert({
      where: { code: agent.code },
      update: { name: agent.name },
      create: agent,
    })
  }
  console.log(`  ✓ ${SHIPPING_AGENTS.length} shipping agents`)

  // The curated subset always seeds first: its hand-verified SPECIFIC and
  // COMPOUND rates (alcohol, tobacco, fuel, vehicles) are the ones the
  // calculation engine is most sensitive to, and the extraction cannot
  // supply them. The full file then fills in everything else around them.
  for (const entry of HS_SUBSET) await seedHsCode(entry)
  console.log(`  ✓ ${HS_SUBSET.length} curated HS codes (verified rates)`)

  const fullFile = path.join(__dirname, 'data', 'hs-codes.json')
  if (!existsSync(fullFile)) {
    console.log('  No tariff extraction at prisma/data/hs-codes.json — curated subset only.')
  } else {
    const raw = JSON.parse(readFileSync(fullFile, 'utf8')) as RawTariffRecord[]
    const curated = new Set(HS_SUBSET.map((c) => c.code))
    const report = normalizeTariffFile(raw, (code) => curated.has(code))

    for (const entry of report.imported) await seedHsCode(entry)

    console.log(`  ✓ ${report.imported.length} HS codes from ${TARIFF_EDITION.name}`)
    console.log(`    ${report.skippedCurated.length} skipped — curated rate is authoritative`)
    for (const [chapter, count] of Object.entries(report.excisableGaps)) {
      console.log(
        `    ⚠ ch.${chapter}: ${count} codes seeded WITHOUT excise/specific duty ` +
          `(${EXCISABLE_CHAPTERS[chapter]})`,
      )
    }
  }

  console.log('Reference seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
