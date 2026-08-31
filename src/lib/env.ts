/**
 * Centralized, validated environment access.
 * Fail fast at boot instead of deep inside a request handler.
 */
import { z } from 'zod'

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true')

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  BEAIP_TRANSPORT_MODE: z.enum(['disabled', 'live']).default('disabled'),
  BEAIP_ENVIRONMENT: z.enum(['qa', 'production']).default('qa'),
  BEAIP_DECLARATION_SERVICE_URL: z.string().optional().default(''),
  BEAIP_DECLARATION_SOAP_ACTION: z.string().optional().default(''),
  BEAIP_USERNAME: z.string().optional().default(''),
  BEAIP_PASSWORD: z.string().optional().default(''),
  BEAIP_SENDER: z.string().optional().default(''),
  BEAIP_RECEIVER: z.string().optional().default('BESWS'),
  BEAIP_TIMEZONE: z.string().default('America/Nassau'),
  BEAIP_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(15_000),
  BEAIP_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(1_048_576),
  BEAIP_ALLOW_INSECURE_QA_HTTP: booleanString.default('false'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).superRefine((value, context) => {
  if (value.BEAIP_TRANSPORT_MODE !== 'live') return
  for (const key of [
    'BEAIP_DECLARATION_SERVICE_URL',
    'BEAIP_USERNAME',
    'BEAIP_PASSWORD',
  ] as const) {
    if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required when BEAIP transport is live` })
  }
  if (value.BEAIP_DECLARATION_SERVICE_URL) {
    let url: URL
    try {
      url = new URL(value.BEAIP_DECLARATION_SERVICE_URL)
    } catch {
      context.addIssue({ code: 'custom', path: ['BEAIP_DECLARATION_SERVICE_URL'], message: 'Invalid declaration service URL' })
      return
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && value.BEAIP_ENVIRONMENT === 'qa' && value.BEAIP_ALLOW_INSECURE_QA_HTTP)) {
      context.addIssue({ code: 'custom', path: ['BEAIP_DECLARATION_SERVICE_URL'], message: 'Plain HTTP is permitted only for QA with BEAIP_ALLOW_INSECURE_QA_HTTP=true' })
    }
  }
})

export type Env = z.infer<typeof envSchema>

let cached: Env | undefined

export function env(): Env {
  if (!cached) cached = envSchema.parse(process.env)
  return cached
}
