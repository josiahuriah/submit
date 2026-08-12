/**
 * Browser-side adapter for Submit's uniform API envelope.
 *
 * Components should not repeat response parsing or silently ignore a failed
 * request. This module keeps the wire contract in one place and follows
 * cursor pagination until every row has been loaded for operational screens.
 */

interface ApiErrorEnvelope {
  error?: {
    code?: string
    message?: string
    details?: Record<string, string[]>
  }
}

interface ApiSuccessEnvelope<T> {
  data: T
  meta?: {
    nextCursor?: string | null
    hasMore?: boolean
  }
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'REQUEST_FAILED',
    readonly details?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const response = await fetch(path, { ...init, headers })
  const payload = (await response.json().catch(() => ({}))) as ApiSuccessEnvelope<T> & ApiErrorEnvelope
  if (!response.ok) {
    throw new ApiClientError(
      payload.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      payload.error?.code,
      payload.error?.details,
    )
  }
  return payload.data
}

export async function apiListAll<T>(path: string): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | null = null

  do {
    const url = new URL(path, window.location.origin)
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)

    const response = await fetch(`${url.pathname}${url.search}`)
    const payload = (await response.json().catch(() => ({}))) as ApiSuccessEnvelope<T[]> & ApiErrorEnvelope
    if (!response.ok) {
      throw new ApiClientError(
        payload.error?.message ?? `Request failed with status ${response.status}`,
        response.status,
        payload.error?.code,
        payload.error?.details,
      )
    }

    rows.push(...payload.data)
    cursor = payload.meta?.hasMore ? payload.meta.nextCursor ?? null : null
  } while (cursor)

  return rows
}
