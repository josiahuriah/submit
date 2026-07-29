/**
 * Uniform API response envelope + centralized error mapping.
 *
 * Success:  { data: T, meta?: {...} }
 * Failure:  { error: { code, message, details? } }
 */
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError } from './errors'

export function ok<T>(data: T, init?: { status?: number; meta?: Record<string, unknown> }) {
  return NextResponse.json(
    { data, ...(init?.meta ? { meta: init.meta } : {}) },
    { status: init?.status ?? 200 },
  )
}

export function created<T>(data: T) {
  return ok(data, { status: 201 })
}

export function fail(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    )
  }
  // Unknown errors: log server-side, never leak internals to the client.
  console.error('[api] unhandled error:', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    { status: 500 },
  )
}
