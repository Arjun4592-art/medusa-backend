import { model } from '@medusajs/framework/utils'

// One row per pinned product per POS tab. tab_key is either a built-in tab id
// or the tab_key of a PosFavoriteTab.
const PosFavorite = model
  .define('pos_favorite', {
    id: model.id({ prefix: 'pfav' }).primaryKey(),
    tab_key: model.text(),
    product_id: model.text(),
    position: model.number().default(0),
  })
  .indexes([
    { on: ['tab_key', 'product_id'], unique: true },
    { on: ['tab_key'] },
  ])

export default PosFavorite
