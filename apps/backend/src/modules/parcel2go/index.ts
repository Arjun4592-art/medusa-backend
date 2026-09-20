import { ModuleProvider, Modules } from '@medusajs/framework/utils'
import Parcel2GoFulfillmentProviderService from './service'

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [Parcel2GoFulfillmentProviderService],
})
