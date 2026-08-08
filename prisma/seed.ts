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
  rate: SeedRate
  rateHistory?: SeedRate[]
}

interface SeedRate {
    dutyBasis?: 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND' | 'ADDITIVE'
    dutyRate?: string
    specificRate?: string
    specificRateUnit?: string
    vatRate?: string
    levyRate?: string
    exciseBasis?: 'NONE' | 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND' | 'ADDITIVE'
    exciseRate?: string
    exciseSpecificRate?: string
    exciseSpecificRateUnit?: string
    effectiveFrom?: Date
    effectiveTo?: Date | null
    changeReason?: string
    gazetteRef?: string
    sourceName?: string
    sourceUrl?: string
    sourcePage?: string
    isVerified?: boolean
}

const EXCISE_2023 = {
  effectiveFrom: new Date('2023-07-01T00:00:00Z'),
  effectiveTo: new Date('2025-07-01T00:00:00Z'),
  changeReason: 'Excise Act, 2023 — historical alcohol rate',
  gazetteRef: 'No. 28 of 2023',
  sourceName: 'Excise Act, 2023',
  sourceUrl:
    'https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/2023/2023-0028/2023-0028.pdf',
  isVerified: true,
} as const

const EXCISE_2025 = {
  effectiveFrom: new Date('2025-07-01T00:00:00Z'),
  effectiveTo: null,
  changeReason: 'Excise (Amendment) Act, 2025 — alcohol rate and unit change',
  gazetteRef: 'No. 42 of 2025',
  sourceName: 'Excise (Amendment) Act, 2025',
  sourceUrl:
    'https://laws.bahamas.gov.bs/cms/images/LEGISLATION/AMENDING/2025/2025-0042A/2025-0042A.pdf',
  sourcePage: '2',
  isVerified: true,
} as const

const EXCISE_AD_VALOREM_2023 = {
  effectiveFrom: new Date('2023-07-01T00:00:00Z'),
  effectiveTo: null,
  changeReason: 'Excise Act, 2023 — ad-valorem beverage rate',
  gazetteRef: 'No. 28 of 2023',
  sourceName: 'Excise Act, 2023',
  sourceUrl:
    'https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/2023/2023-0028/2023-0028.pdf',
  sourcePage: '12-13',
  isVerified: true,
} as const

const TARIFF_2023 = {
  effectiveFrom: new Date('2023-07-01T00:00:00Z'),
  effectiveTo: null,
  sourceName: '2023 Bahamas Tariff Schedule',
  sourcePage: '173',
  gazetteRef: 'Tariff Act, 2023',
  isVerified: true,
} as const

const HS_SUBSET: SeedHsCode[] = [
  // Ch. 02–21 — foodstuffs
  { code: '0201.10.00', description: 'Beef carcasses and half-carcasses, fresh or chilled', unit: 'KG', chapterName: 'Meat', rate: { dutyRate: '0' } },
  { code: '0207.14.00', description: 'Chicken cuts and offal, frozen', unit: 'KG', chapterName: 'Meat', rate: { dutyRate: '0' } },
  { code: '0402.10.00', description: 'Milk powder, fat content ≤ 1.5%', unit: 'KG', chapterName: 'Dairy produce', rate: { dutyRate: '0.05' } },
  { code: '1006.30.00', description: 'Semi-milled or wholly milled rice', unit: 'KG', chapterName: 'Cereals', rate: { dutyRate: '0' } },
  { code: '1905.31.00', description: 'Sweet biscuits', unit: 'KG', chapterName: 'Preparations of cereals', rate: { dutyRate: '0.10' } },
  { code: '2009.11.00', description: 'Orange juice, frozen', unit: 'L', chapterName: 'Beverages, juices', rate: { dutyRate: '0.30' } },

  // Ch. 22 — tariff/excise rules verified against the supplied tariff, Customs
  // calculation deck, Excise Act 2023, and the amendment effective 2025-07-01.
  // Beer is ADDITIVE: 10% of CIF + BSD 10 per imperial gallon.
  { code: '2203.00.10', description: 'Ale', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...TARIFF_2023, dutyBasis: 'ADDITIVE', dutyRate: '0.10', specificRate: '10.00', specificRateUnit: 'IMP_GAL' } },
  { code: '2203.00.20', description: 'Porter', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...TARIFF_2023, dutyBasis: 'ADDITIVE', dutyRate: '0.10', specificRate: '10.00', specificRateUnit: 'IMP_GAL' } },
  { code: '2203.00.30', description: 'Stout', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...TARIFF_2023, dutyBasis: 'ADDITIVE', dutyRate: '0.10', specificRate: '10.00', specificRateUnit: 'IMP_GAL' } },
  { code: '2203.00.90', description: 'Other beers', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...TARIFF_2023, dutyBasis: 'ADDITIVE', dutyRate: '0.10', specificRate: '10.00', specificRateUnit: 'IMP_GAL' } },

  // Wine remains free of general customs duty but carries ad-valorem excise.
  { code: '2204.10.00', description: 'Sparkling wine', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...EXCISE_AD_VALOREM_2023, dutyRate: '0', exciseBasis: 'AD_VALOREM', exciseRate: '0.50' } },
  { code: '2204.21.10', description: 'Wine-based coolers, containers not over 2L', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...EXCISE_AD_VALOREM_2023, dutyRate: '0', exciseBasis: 'AD_VALOREM', exciseRate: '0.35' } },
  { code: '2204.21.90', description: 'Other wine, containers not over 2L', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...EXCISE_AD_VALOREM_2023, dutyRate: '0', exciseBasis: 'AD_VALOREM', exciseRate: '0.50' } },
  { code: '2204.22.00', description: 'Wine, containers over 2L but not over 10L', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...EXCISE_AD_VALOREM_2023, dutyRate: '0', exciseBasis: 'AD_VALOREM', exciseRate: '0.50' } },
  { code: '2204.29.00', description: 'Other wine', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...EXCISE_AD_VALOREM_2023, dutyRate: '0', exciseBasis: 'AD_VALOREM', exciseRate: '0.50' } },
  { code: '2204.30.00', description: 'Other grape must', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...EXCISE_AD_VALOREM_2023, dutyRate: '0', exciseBasis: 'AD_VALOREM', exciseRate: '0.35' } },

  // Brandy, whisky, rum, gin and vodka changed from $15/proof gallon to
  // $13/imperial gallon on 2025-07-01. Both versions remain for auditability.
  ...[
    ['2208.20.10', 'Brandy, bottles not exceeding 46% vol.'],
    ['2208.20.90', 'Other grape spirits'],
    ['2208.30.10', 'Whisky, bottles not exceeding 46% vol.'],
    ['2208.30.90', 'Other whisky'],
    ['2208.40.10', 'Rum, bottles not exceeding 46% vol.'],
    ['2208.40.90', 'Other rum and sugar-cane spirits'],
    ['2208.50.10', 'Gin, bottles not exceeding 46% vol.'],
    ['2208.50.90', 'Other gin and Geneva'],
    ['2208.60.00', 'Vodka'],
  ].map(([code, description]) => ({
    code,
    description,
    unit: 'IMP_GAL',
    chapterName: 'Beverages, spirits and vinegar',
    rate: { ...EXCISE_2025, dutyRate: '0', exciseBasis: 'SPECIFIC' as const, exciseSpecificRate: '13.00', exciseSpecificRateUnit: 'IMP_GAL' },
    rateHistory: [{ ...EXCISE_2023, dutyRate: '0', exciseBasis: 'SPECIFIC' as const, exciseSpecificRate: '15.00', exciseSpecificRateUnit: 'PROOF_GAL', sourcePage: '12-13' }],
  })),
  ...[
    ['2208.70.00', 'Liqueurs and cordials'],
    ['2208.90.90', 'Other spirituous beverages'],
  ].map(([code, description]) => ({
    code,
    description,
    unit: 'IMP_GAL',
    chapterName: 'Beverages, spirits and vinegar',
    rate: { ...EXCISE_2025, dutyRate: '0', exciseBasis: 'SPECIFIC' as const, exciseSpecificRate: '13.00', exciseSpecificRateUnit: 'IMP_GAL' },
    rateHistory: [{ ...EXCISE_2023, dutyRate: '0', exciseBasis: 'SPECIFIC' as const, exciseSpecificRate: '15.00', exciseSpecificRateUnit: 'IMP_GAL', sourcePage: '13' }],
  })),
  { code: '2208.90.10', description: 'Spirits-based coolers', unit: 'IMP_GAL', chapterName: 'Beverages, spirits and vinegar', rate: { ...EXCISE_AD_VALOREM_2023, dutyRate: '0', exciseBasis: 'AD_VALOREM', exciseRate: '0.35', sourcePage: '13' } },

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

  for (const historical of entry.rateHistory ?? []) {
    await seedHsRate(hsCode.id, historical)
  }
  await seedHsRate(hsCode.id, entry.rate)
}

async function seedHsRate(hsCodeId: string, rate: SeedRate) {
  const effectiveFrom = rate.effectiveFrom ?? TARIFF_EDITION.effectiveFrom
  const existing = await prisma.hSCodeRate.findFirst({
    where: { hsCodeId, effectiveFrom },
  })
  const rateData = {
    dutyBasis: rate.dutyBasis ?? 'AD_VALOREM',
    dutyRate: rate.dutyRate ?? '0',
    specificRate: rate.specificRate ?? null,
    specificRateUnit: rate.specificRateUnit ?? null,
    vatRate: rate.vatRate ?? '0.10',
    levyRate: rate.levyRate ?? '0',
    exciseBasis: rate.exciseBasis ?? 'NONE',
    exciseRate: rate.exciseRate ?? '0',
    exciseSpecificRate: rate.exciseSpecificRate ?? null,
    exciseSpecificRateUnit: rate.exciseSpecificRateUnit ?? null,
    effectiveTo: rate.effectiveTo ?? null,
    changeReason: rate.changeReason ?? TARIFF_EDITION.changeReason,
    gazetteRef: rate.gazetteRef ?? null,
    sourceName: rate.sourceName ?? TARIFF_EDITION.name,
    sourceUrl: rate.sourceUrl ?? null,
    sourcePage: rate.sourcePage ?? null,
    isVerified: rate.isVerified ?? false,
  } as const
  if (existing) {
    await prisma.hSCodeRate.update({ where: { id: existing.id }, data: rateData })
  } else {
    await prisma.hSCodeRate.create({
      data: {
        hsCodeId,
        effectiveFrom,
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
  console.log(`  ✓ ${new Set(HS_SUBSET.map((entry) => entry.code)).size} curated HS codes/rate histories`)

  // Older demo-only broad codes were never real national tariff lines. Keep
  // historical rows intact but remove them from search and active calculation.
  const legacyIncorrectCodes = ['2204.21.00', '2208.30.00', '2208.40.00']
  await prisma.hSCode.updateMany({
    where: { code: { in: legacyIncorrectCodes } },
    data: { isActive: false },
  })

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
