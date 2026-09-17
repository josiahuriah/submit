/** Reference builders for Click2Clear declaration XML. */

const MAX_DECLARATION_SEQUENCE = 999_999_999n

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

/** Globally allocated declaration reference. Example: SUBMITDEC000000001. */
export function buildFunctionalReferenceId(sequence: number | bigint): string {
  const value = typeof sequence === 'bigint' ? sequence : BigInt(sequence)
  if (value < 1n || value > MAX_DECLARATION_SEQUENCE) {
    throw new Error('Declaration reference sequence must be between 1 and 999999999')
  }
  return `SUBMITDEC${String(value).padStart(9, '0')}`
}

/** Example shape: 201800OREF02331212. */
export function buildTraderAssignedReferenceId(
  declarationDate: string,
  sourceReference: string,
): string {
  return `${referenceYear(declarationDate)}00OREF${fixedWidthNumericReference(sourceReference, 8)}`
}

/** Batch-seeded broker references keep split declarations distinct and auditable. */
export function buildSubmissionReferences(
  declarationDate: string,
  seed: string,
  functionalSequence: number | bigint,
) {
  return {
    functionalReferenceId: buildFunctionalReferenceId(functionalSequence),
    brokerReference: `${referenceYear(declarationDate)}00OREF${hashedNumericReference(`${seed}:broker`, 8)}`,
  }
}
