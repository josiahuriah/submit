/** Live filing uses the configured BEAIP code; tenant data remains an offline-review fallback. */
export function resolveBeaipBrokerCode(
  configuredBrokerCode: string,
  organizationCompanyRegistrationNumber: string | null,
): string {
  return configuredBrokerCode.trim() || organizationCompanyRegistrationNumber?.trim() || ''
}

/** Customs-reviewed filing values for the current Click2Clear QA profile. */
export const TFP_DECLARATION_OFFICE_CODE = 'NASACP'
export const TFP_DECLARANT_NAME = 'Atlas Brokers'
export const TFP_QA_PARTY_ID = '20113855131249792'
export const TFP_QA_PLACE_OF_DISCHARGE_CODE = 'USPBI'
export const TFP_EACH_UNIT_CODE = 'EA'
export const TFP_STANDARD_IMPORT_WIRE_CPC = '40000'

/** This workflow creates original declarations only. */
export const ORIGINAL_DECLARATION_FUNCTION_CODE = '9' as const
