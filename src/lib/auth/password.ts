/**
 * Password hashing. bcryptjs (pure JS) — no native build step, works on
 * Vercel serverless. Cost 12 ≈ 250ms, the standard interactive-login balance.
 */
import bcrypt from 'bcryptjs'

const BCRYPT_COST = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
