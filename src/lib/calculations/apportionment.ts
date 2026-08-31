/**
 * Cost apportionment — distributing shipment-level charges (freight,
 * insurance, other) across line items.
 *
 * Correctness requirement: the per-line amounts, each rounded to cents,
 * must sum EXACTLY to the original charge. Naive per-line rounding leaves
 * stray pennies that make declared totals disagree with the manifest —
 * exactly the kind of accuracy bug CayDeclarations is known for.
 *
 * Algorithm: largest-remainder method.
 *   1. Compute each line's exact proportional share.
 *   2. Floor every share to cents; track each line's fractional remainder.
 *   3. Hand the leftover cents, one each, to the lines with the largest
 *      remainders (ties broken by line order for determinism).
 */
import { Decimal, d, ZERO, type DecimalInput } from './money'

export type ApportionmentBasis = 'VALUE' | 'WEIGHT'

export interface ApportionableLine {
  /** stable identifier so callers can map results back */
  id: string
  /** line FOB value (basis VALUE) */
  totalValue: DecimalInput
  /** line weight in lb (basis WEIGHT) — optional, falls back to value */
  weightLb?: DecimalInput | null
}

export interface ApportionedAmount {
  id: string
  amount: Decimal
}

/**
 * Distribute `charge` across `lines` proportionally to the chosen basis.
 * Returns one entry per line, in input order; the amounts sum exactly to
 * toMoney(charge).
 */
export function apportion(
  charge: DecimalInput,
  lines: ApportionableLine[],
  basis: ApportionmentBasis = 'VALUE',
): ApportionedAmount[] {
  const total = d(charge).toDecimalPlaces(2)
  if (lines.length === 0) return []
  if (total.isZero()) return lines.map((l) => ({ id: l.id, amount: ZERO }))

  const weights = lines.map((l) => basisWeight(l, basis))
  const basisTotal = weights.reduce((acc, w) => acc.plus(w), ZERO)

  // Degenerate case: all-zero basis (e.g. free-of-charge samples).
  // Fall back to equal split so the charge is still fully allocated.
  const effectiveWeights = basisTotal.isZero() ? lines.map(() => new Decimal(1)) : weights
  const effectiveTotal = basisTotal.isZero() ? new Decimal(lines.length) : basisTotal

  const totalCents = total.times(100)

  // Step 1–2: floored share + remainder per line.
  const floored = effectiveWeights.map((w) => {
    const exactCents = totalCents.times(w).dividedBy(effectiveTotal)
    const flooredCents = exactCents.floor()
    return { flooredCents, remainder: exactCents.minus(flooredCents) }
  })

  // Step 3: distribute leftover cents to the largest remainders.
  const allocated = floored.reduce((acc, f) => acc.plus(f.flooredCents), ZERO)
  let leftoverCents = totalCents.minus(allocated).toNumber() // small integer

  const order = floored
    .map((f, index) => ({ index, remainder: f.remainder }))
    .sort((a, b) => {
      const cmp = b.remainder.comparedTo(a.remainder)
      return cmp !== 0 ? cmp : a.index - b.index
    })

  const extra = new Array<number>(lines.length).fill(0)
  for (const { index } of order) {
    if (leftoverCents <= 0) break
    extra[index] = 1
    leftoverCents -= 1
  }

  return lines.map((line, i) => ({
    id: line.id,
    amount: floored[i]!.flooredCents.plus(extra[i]!).dividedBy(100),
  }))
}

function basisWeight(line: ApportionableLine, basis: ApportionmentBasis): Decimal {
  if (basis === 'WEIGHT') {
    const w = d(line.weightLb)
    if (w.greaterThan(0)) return w
    // Missing weight on a weight-basis apportionment: fall back to value so
    // the line still receives a fair share instead of zero.
    return d(line.totalValue)
  }
  return d(line.totalValue)
}
