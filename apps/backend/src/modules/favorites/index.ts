import { Module } from '@medusajs/framework/utils'
import FavoritesModuleService from './service'

export const FAVORITES_MODULE = 'favorites'

export default Module(FAVORITES_MODULE, {
  service: FavoritesModuleService,
})
