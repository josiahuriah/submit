import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { declarationArtifactsService } from '@/server/services/declaration-artifacts.service'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  const artifact = await declarationArtifactsService.getXml(db, id)
  return new NextResponse(artifact.xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}, { permission: 'shipments:read' })
