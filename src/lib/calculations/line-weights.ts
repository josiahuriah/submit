import { apportion, type ApportionableLine } from './apportionment'
import { d, type DecimalInput } from './money'
import { BusinessRuleError } from '@/lib/errors'

/** Largest remainder at 0.001 lb; value-based, equal shares for all-zero values. */
export function allocateLineWeights(total: DecimalInput, lines: ApportionableLine[], allowZero = false) {
  const weight = d(total)
  if (!weight.isFinite() || (allowZero ? weight.lessThan(0) : weight.lessThanOrEqualTo(0))) {
    throw new BusinessRuleError('Enter a shipment gross weight greater than zero before calculating line weights.')
  }
  if (lines.some((line) => d(line.totalValue).lessThan(0))) {
    throw new BusinessRuleError('Line values cannot be negative when allocating weight.')
  }
  // apportion rounds to hundredths; scaling by ten allocates thousandths of a pound.
  return apportion(weight.toDecimalPlaces(3).times(10), lines, 'VALUE')
    .map(({ id, amount }) => ({ id, weightLb: amount.div(10).toFixed(3) }))
}
