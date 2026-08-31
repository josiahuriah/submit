/**
 * TARIFF EXTRACTION IMPORTER
 * =============================================================================
 * Normalizes a raw Bahamas Tariff Schedule extraction (prisma/data/hs-codes.json)
 * into the SeedHsCode shape that seed.ts writes.
 *
 * WHY THIS FILE EXISTS
 * Tariff rates change yearly, so the extraction is re-imported periodically.
 * The raw file's shape does NOT match what the seed writes, and a naive load
 * corrupts money math (details below). Keeping every transform decision in one
 * documented, unit-tested place means next year's import is a file swap plus a
 * bump of TARIFF_EDITION — not a re-derivation of these rules.
 *
 * WHAT THE RAW EXTRACTION ACTUALLY CONTAINS
 * It is a DUTY-RATE-ONLY extraction. Per-record fields are:
 *   code, description, chapter, heading, subheading, unit, sectionNumber,
 *   sectionName, chapterName, dutyRate, generalRate, specificRate,
 *   maxVariableRate, preferentialRate
 * There is NO VAT, levy, or excise column, and no usable specific-rate column.
 *
 * THE FOUR TRANSFORM DECISIONS (owner-approved 2026-07-28)
 *
 * 1. CODE FORMAT — the extraction writes `2208.3000`; Submit stores and sends
 *    the canonical eight numeric digits (`22083000`).
 *
 * 2. specificRate IS DISCARDED — the raw column holds only the literal '300%'
 *    (169 records) or 'None'. A percentage cannot be a specific rate, which is
 *    BSD-per-unit in this schema. The affected records are mostly beef and
 *    produce lines whose duty is 'Free'; mapping '300%' through would assess
 *    $300 per pound. It is an extraction artifact and is dropped, never mapped.
 *    Every imported line is therefore AD_VALOREM.
 *
 * 3. CURATED LINES ARE NEVER OVERWRITTEN — seed.ts's HS_SUBSET carries
 *    hand-verified SPECIFIC and COMPOUND rates for alcohol, tobacco, fuel and
 *    vehicles (e.g. spirits with effective-dated excise, cigarettes compound). The extraction has
 *    dutyRate 0 and no excise for those same lines, so importing them would
 *    zero out the duty on exactly the goods this product calculates most
 *    carefully. isCurated() guards them; skipped codes are reported.
 *
 * 4. VAT/LEVY/EXCISE FALL BACK TO SCHEMA DEFAULTS (VAT 10%, levy 0, excise 0)
 *    because the extraction carries no such data. This is CORRECT for ordinary
 *    goods and WRONG for excisable ones — see EXCISABLE_CHAPTERS, which the
 *    importer reports so the gap stays visible rather than silent.
 */

export const TARIFF_EDITION = {
  /** Human label for the source document. */
  name: '2023 Bahamas Tariff Schedule',
  /** Rate validity start — becomes HSCodeRate.effectiveFrom. */
  effectiveFrom: new Date('2023-07-01T00:00:00Z'),
  /** Recorded on every rate row for provenance. */
  changeReason: 'Initial seed — 2023 Tariff Schedule',
} as const

/**
 * Chapters whose goods carry excise/specific duty this extraction cannot
 * supply. Imported lines in these chapters get defaults that understate what
 * is payable, so they are counted and surfaced at import time.
 */
export const EXCISABLE_CHAPTERS: Record<string, string> = {
  '22': 'Beverages, spirits — specific duty per litre',
  '24': 'Tobacco — compound duty',
  '27': 'Mineral fuels — specific duty per litre',
  '87': 'Vehicles — excise by engine size',
}

/** A record exactly as it appears in prisma/data/hs-codes.json. */
export interface RawTariffRecord {
  code: string
  description: string
  chapter: string
  heading: string
  subheading: string
  unit: string
  sectionNumber: string
  sectionName: string
  chapterName: string
  dutyRate: string
  generalRate: string
  specificRate: string
  maxVariableRate: string | null
  preferentialRate: string
}

/** The shape seed.ts writes. Mirrors SeedHsCode there. */
export interface NormalizedHsCode {
  code: string
  description: string
  unit?: string
  chapterName?: string
  sectionNumber?: string
  sectionName?: string
  rate: {
    dutyBasis: 'AD_VALOREM'
    dutyRate: string
  }
}

/**
 * The extraction's statistical units, mapped to the short codes used elsewhere
 * in this system. Cosmetic only — unit is display metadata; the field that
 * drives math is specificRateUnit, which this importer never sets.
 */
const UNIT_MAP: Record<string, string> = {
  number: 'PCS',
  pound: 'LB',
  gallon: 'GAL',
  ton: 'TON',
}

/** `0201.1000` -> `02011000`. Throws on anything not xxxx.dddd. */
export function normalizeCode(raw: string): string {
  const match = /^(\d{4})\.(\d{2})(\d{2})$/.exec(raw.trim())
  if (!match) {
    throw new Error(
      `Tariff code "${raw}" is not in the expected xxxx.dddd form. ` +
        `A new extraction format needs an explicit rule here — do not guess.`,
    )
  }
  return `${match[1]}${match[2]}${match[3]}`
}

/**
 * Strips extraction artifacts: leading `**` footnote markers and the `---`
 * indent dashes the PDF tables use to show subheading nesting.
 */
export function cleanDescription(raw: string): string {
  return raw
    .replace(/\*\*/g, ' ')
    .replace(/^[\s-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cross-checks the file's two duty columns against each other. `dutyRate`
 * ('0.4500') is the decimal the system stores; `generalRate` ('45%' / 'Free')
 * is the human column. They agree throughout the 2023 extraction — if a future
 * extraction disagrees, one of the columns was misparsed and the import must
 * stop rather than persist a wrong rate.
 */
export function assertDutyColumnsAgree(record: RawTariffRecord): void {
  const decimal = Number(record.dutyRate)
  const general = record.generalRate.trim()
  const expected = general === 'Free' ? 0 : Number(general.replace('%', '')) / 100
  if (!Number.isFinite(decimal) || !Number.isFinite(expected)) {
    throw new Error(`${record.code}: unparseable duty (${record.dutyRate} / ${general})`)
  }
  if (Math.abs(decimal - expected) > 1e-9) {
    throw new Error(
      `${record.code}: duty columns disagree — dutyRate=${record.dutyRate} ` +
        `but generalRate=${general}. Extraction is unreliable; import halted.`,
    )
  }
}

/** Normalize one raw record. Throws if the record cannot be trusted. */
export function normalizeTariffEntry(record: RawTariffRecord): NormalizedHsCode {
  assertDutyColumnsAgree(record)
  return {
    code: normalizeCode(record.code),
    description: cleanDescription(record.description),
    unit: UNIT_MAP[record.unit] ?? record.unit,
    chapterName: record.chapterName,
    sectionNumber: record.sectionNumber,
    sectionName: record.sectionName,
    // Always AD_VALOREM: see transform decision 2 — the raw specificRate
    // column is an artifact and is deliberately discarded.
    rate: { dutyBasis: 'AD_VALOREM', dutyRate: record.dutyRate },
  }
}

export interface ImportReport {
  imported: NormalizedHsCode[]
  /** Codes skipped because a hand-verified curated rate already covers them. */
  skippedCurated: string[]
  /** Imported code counts per excisable chapter (defaults understate these). */
  excisableGaps: Record<string, number>
}

/**
 * Normalize a whole extraction.
 * `isCurated` receives the NORMALIZED code and protects hand-verified rates.
 */
export function normalizeTariffFile(
  records: RawTariffRecord[],
  isCurated: (code: string) => boolean,
): ImportReport {
  const imported: NormalizedHsCode[] = []
  const skippedCurated: string[] = []
  const excisableGaps: Record<string, number> = {}

  for (const record of records) {
    const entry = normalizeTariffEntry(record)
    if (isCurated(entry.code)) {
      skippedCurated.push(entry.code)
      continue
    }
    const chapter = entry.code.slice(0, 2)
    if (chapter in EXCISABLE_CHAPTERS) {
      excisableGaps[chapter] = (excisableGaps[chapter] ?? 0) + 1
    }
    imported.push(entry)
  }

  return { imported, skippedCurated, excisableGaps }
}
