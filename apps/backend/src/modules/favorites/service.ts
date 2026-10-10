import { MedusaService } from '@medusajs/framework/utils'
import PosFavorite from './models/pos-favorite'
import PosFavoriteTab from './models/pos-favorite-tab'
import WishlistItem from './models/wishlist-item'

class FavoritesModuleService extends MedusaService({
  PosFavorite,
  PosFavoriteTab,
  WishlistItem,
}) {}

export default FavoritesModuleService
