import { model } from '@medusajs/framework/utils'

// Custom (staff-created) POS favorites tabs. Built-in tabs live in code.
const PosFavoriteTab = model.define('pos_favorite_tab', {
  id: model.id({ prefix: 'pftab' }).primaryKey(),
  // The id the storefront uses, e.g. "custom-lk3j2h9x4f2a"
  tab_key: model.text().unique(),
  label: model.text(),
})

export default PosFavoriteTab
