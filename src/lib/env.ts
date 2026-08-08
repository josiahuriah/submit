/**
 * Centralized, validated environment access.
 * Fail fast at boot instead of deep inside a request handler.
 */
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | undefined

export function env(): Env {
  if (!cached) cached = envSchema.parse(process.env)
  return cached
}
