/**
 * Cursor-based pagination helpers.
 * Cursor pagination stays fast at any depth (unlike OFFSET, which scans and
 * discards) — important for line-item-heavy shipments.
 */

export interface PaginationParams {
  cursor?: string
  limit?: number
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_PAGE_SIZE
  return Math.min(Math.max(1, limit), MAX_PAGE_SIZE)
}

/**
 * Build Prisma args for a cursor page. We fetch limit+1 rows to know whether
 * a next page exists without a second COUNT query.
 */
export function cursorArgs(params: PaginationParams) {
  const take = clampLimit(params.limit)
  return {
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  }
}

/** Convert an over-fetched row list into a Page. */
export function toPage<T extends { id: string }>(rows: T[], params: PaginationParams): Page<T> {
  const take = clampLimit(params.limit)
  const hasMore = rows.length > take
  const items = hasMore ? rows.slice(0, take) : rows
  return {
    items,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]!.id : null,
  }
}
