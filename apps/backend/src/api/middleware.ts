import { authenticate, defineMiddlewares } from '@medusajs/framework/http'

export default defineMiddlewares({
  routes: [
    {
      // Wishlist is per customer: require a logged-in customer (bearer token
      // from the storefront, or session).
      matcher: '/store/wishlist*',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
  ],
})
