/** TFP declaration mapping and XML serialization exports. */

export type {
  BeaipDeclaration,
  BeaipDeclarationLine,
  BeaipInvoice,
  BeaipParty,
  BeaipPartyAddress,
  BeaipTransport,
} from './types'
export { buildWcoDeclarationXml, WCO_DECLARATION_NS } from './wco-xml'
