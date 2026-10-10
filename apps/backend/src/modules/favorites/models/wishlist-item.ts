import { model } from '@medusajs/framework/utils'

// One row per product a customer has wishlisted on the website.
const WishlistItem = model
  .define('wishlist_item', {
    id: model.id({ prefix: 'wish' }).primaryKey(),
    customer_id: model.text(),
    product_id: model.text(),
  })
  .indexes([
    { on: ['customer_id', 'product_id'], unique: true },
    { on: ['customer_id'] },
  ])

export default WishlistItem
