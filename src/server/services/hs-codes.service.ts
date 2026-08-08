/**
 * HS code search — global reference data (NOT tenant-scoped).
 *
 * Search strategy:
 *   1. Exact/prefix code match first ("2208" should surface heading 2208.*)
 *   2. Trigram similarity on description (pg_trgm GIN index) for text like
 *      "shampoo" or "ladies dress"
 * Results always join the current rate (effectiveTo IS NULL) so the UI can
 * show duty% next to each hit — brokers pick codes by comparing rates.
 *
 * LRU cache: the tariff changes ~annually; identical searches repeat all day.
 */
import { basePrisma } from '@/lib/db/prisma'
import type { Prisma } from '@/generated/prisma/client'

interface CacheEntry<T> { at: number; value: T }
const CACHE_MAX = 500
const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, CacheEntry<HsSearchResult[]>>()

function cacheGet(key: string): HsSearchResult[] | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return undefined }
  // LRU: re-insert on access.
  cache.delete(key); cache.set(key, hit)
  return hit.value
}

function cacheSet(key: string, value: HsSearchResult[]): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), value })
}

/** One search hit, with its currently-effective rate (null if unrated). */
export interface HsSearchResult {
  id: string
  code: string
  description: string
  chapter: string
  heading: string
  unit: string | null
  requiresPermit: boolean
  permitType: string | null
  currentRate: {
    dutyBasis: 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND' | 'ADDITIVE'
    dutyRate: unknown
    specificRate: unknown
    specificRateUnit: string | null
    vatRate: unknown
    levyRate: unknown
    exciseBasis: 'NONE' | 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND' | 'ADDITIVE'
    exciseRate: unknown
    exciseSpecificRate: unknown
    exciseSpecificRateUnit: string | null
    effectiveFrom: Date
    effectiveTo: Date | null
    sourceName: string | null
    sourceUrl: string | null
    sourcePage: string | null
    isVerified: boolean
  } | null
}

function resultSelect(now: Date) {
  return {
  id: true, code: true, description: true, chapter: true, heading: true,
  unit: true, requiresPermit: true, permitType: true,
  rateHistory: {
    where: {
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      dutyBasis: true, dutyRate: true, specificRate: true, specificRateUnit: true,
      vatRate: true, levyRate: true, exciseBasis: true, exciseRate: true,
      exciseSpecificRate: true, exciseSpecificRateUnit: true,
      effectiveFrom: true, effectiveTo: true, sourceName: true, sourceUrl: true,
      sourcePage: true, isVerified: true,
    },
    orderBy: { effectiveFrom: 'desc' as const },
    take: 1,
  },
  } satisfies Prisma.HSCodeSelect
}

export const hsCodesService = {
  async search(query: string, limit = 20): Promise<HsSearchResult[]> {
    const key = `${query.toLowerCase()}|${limit}`
    const cached = cacheGet(key)
    if (cached) return cached

    const looksLikeCode = /^[\d.]+$/.test(query.trim())
    const results = await basePrisma.hSCode.findMany({
      where: {
        isActive: true,
        ...(looksLikeCode
          ? { code: { startsWith: query.trim() } }
          : { description: { contains: query, mode: 'insensitive' } }),
      },
      select: resultSelect(new Date()),
      orderBy: { code: 'asc' },
      take: limit,
    })

    const shaped: HsSearchResult[] = results.map((r) => ({
      id: r.id,
      code: r.code,
      description: r.description,
      chapter: r.chapter,
      heading: r.heading,
      unit: r.unit,
      requiresPermit: r.requiresPermit,
      permitType: r.permitType,
      currentRate: r.rateHistory[0] ?? null,
    }))
    cacheSet(key, shaped)
    return shaped
  },

  /** Complete effective-dated ledger for one tariff line, newest first. */
  async rateHistory(code: string) {
    const hsCode = await basePrisma.hSCode.findUnique({
      where: { code },
      select: {
        code: true,
        description: true,
        unit: true,
        isActive: true,
        rateHistory: {
          select: {
            id: true,
            dutyBasis: true,
            dutyRate: true,
            specificRate: true,
            specificRateUnit: true,
            vatRate: true,
            levyRate: true,
            exciseBasis: true,
            exciseRate: true,
            exciseSpecificRate: true,
            exciseSpecificRateUnit: true,
            effectiveFrom: true,
            effectiveTo: true,
            changeReason: true,
            gazetteRef: true,
            sourceName: true,
            sourceUrl: true,
            sourcePage: true,
            isVerified: true,
          },
          orderBy: { effectiveFrom: 'desc' },
        },
      },
    })
    return hsCode
  },
}
