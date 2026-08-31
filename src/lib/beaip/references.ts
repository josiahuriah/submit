/**
 * Temporary Click2Clear-shaped references for review XML.
 *
 * Click2Clear is expected to replace the declaration reference when live
 * submission is integrated. Until then, review files need stable references
 * that follow the examples supplied by Customs.
 */

function referenceYear(declarationDate: string): string {
  const year = new Date(declarationDate).getUTCFullYear()
  if (!Number.isInteger(year)) throw new Error('Declaration date is invalid')
  return String(year)
}

function numericSeed(sourceReference: string): string {
  const trailingDigits = sourceReference.match(/(\d+)$/)?.[1]
  if (trailingDigits) return trailingDigits

  const allDigits = sourceReference.replace(/\D/g, '')
  if (allDigits) return allDigits

  // Stable numeric fallback for human references that contain no digits.
  let hash = 2166136261
  for (const character of sourceReference) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
  }
  return String(hash)
}

function fixedWidthNumericReference(sourceReference: string, width: number): string {
  return numericSeed(sourceReference).slice(-width).padStart(width, '0')
}

function hashedNumericReference(seed: string, width: number): string {
  let first = 2166136261
  let second = 0x9e3779b9
  for (const character of seed) {
    first = Math.imul(first ^ character.charCodeAt(0), 16777619) >>> 0
    second = Math.imul(second ^ character.charCodeAt(0), 2246822519) >>> 0
  }
  return `${first}${second}`.slice(0, width).padEnd(width, '0')
}

/** Example shape: 2026DEC0001234567. */
export function buildFunctionalReferenceId(
  declarationDate: string,
  sourceReference: string,
): string {
  return `${referenceYear(declarationDate)}DEC${fixedWidthNumericReference(sourceReference, 10)}`
}

/** Example shape: 201800OREF02331212. */
export function buildTraderAssignedReferenceId(
  declarationDate: string,
  sourceReference: string,
): string {
  return `${referenceYear(declarationDate)}00OREF${fixedWidthNumericReference(sourceReference, 8)}`
}

/** Batch-seeded references keep split declarations distinct and auditable. */
export function buildSubmissionReferences(declarationDate: string, seed: string) {
  return {
    functionalReferenceId: `${referenceYear(declarationDate)}DEC${hashedNumericReference(seed, 10)}`,
    brokerReference: `${referenceYear(declarationDate)}00OREF${hashedNumericReference(`${seed}:broker`, 8)}`,
  }
}
