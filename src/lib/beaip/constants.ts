/** Live filing uses the configured BEAIP code; tenant data remains an offline-review fallback. */
export function resolveBeaipBrokerCode(
  configuredBrokerCode: string,
  organizationCompanyRegistrationNumber: string | null,
): string {
  return configuredBrokerCode.trim() || organizationCompanyRegistrationNumber?.trim() || ''
}

/** Stakeholder-approved filing defaults pending the Click2Clear master sheets. */
export const TFP_DECLARATION_OFFICE_CODE = 'NASACP'
export const TFP_DECLARANT_NAME = 'Atlas Brokers'

/** This workflow creates original declarations only. */
export const ORIGINAL_DECLARATION_FUNCTION_CODE = '9' as const
