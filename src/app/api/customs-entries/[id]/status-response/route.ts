import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { customsStatusService } from '@/server/services/customs-status.service'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  const result = await customsStatusService.getLatestResponse(db, id)
  return new NextResponse(result.response, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}, { permission: 'shipments:read' })
