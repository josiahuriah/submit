/**
 * BEAIP client factory. The rest of the app imports getBeaipClient() and
 * never knows whether it's talking to the mock or the real Single Window —
 * flipping BEAIP_MODE=production (with credentials) is the entire cutover.
 */
import { env } from '@/lib/env'
import { MockBeaipClient } from './mock-client'
import { ProductionBeaipClient } from './production-client'
import type { BeaipClient } from './types'

export type { BeaipClient, BeaipDeclaration, BeaipSubmissionResult } from './types'

let instance: BeaipClient | undefined

export function getBeaipClient(): BeaipClient {
  if (!instance) {
    instance = env().BEAIP_MODE === 'production' ? new ProductionBeaipClient() : new MockBeaipClient()
  }
  return instance
}
