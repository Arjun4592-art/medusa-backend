import { ModuleProvider, Modules } from '@medusajs/framework/utils'
import RoyalMailFulfillmentProviderService from './service'

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [RoyalMailFulfillmentProviderService],
})
