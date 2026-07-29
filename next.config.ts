import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prisma 7 generated client + pg driver stay external to the server bundle.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
}

export default nextConfig
