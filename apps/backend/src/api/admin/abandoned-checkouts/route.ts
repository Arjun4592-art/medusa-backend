import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Number(req.query.offset) || 0
  // how long a cart has to sit untouched before it counts as "abandoned"
  const minutes = Number(req.query.minutes) || 60
  const cutoff = new Date(Date.now() - minutes * 60 * 1000)

  const { data: carts, metadata } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'email',
      'currency_code',
      'created_at',
      'updated_at',
      'items.*',
      'customer.*',
      'shipping_address.*',
    ],
    filters: {
      completed_at: null,
      updated_at: { $lt: cutoff },
    },
    pagination: {
      skip: offset,
      take: limit,
      order: { updated_at: 'DESC' },
    },
  })

  // only carts that actually have something in them count as "abandoned"
  const withItems = carts.filter((cart: any) => (cart.items?.length ?? 0) > 0)

  const abandonedCheckouts = withItems.map((cart: any) => ({
    id: cart.id,
    email: cart.email ?? cart.customer?.email ?? null,
    customer_name: cart.customer
      ? `${cart.customer.first_name ?? ''} ${cart.customer.last_name ?? ''}`.trim() ||
        null
      : cart.shipping_address
        ? `${cart.shipping_address.first_name ?? ''} ${cart.shipping_address.last_name ?? ''}`.trim() ||
          null
        : null,
    item_count: cart.items?.length ?? 0,
    value: (cart.items ?? []).reduce(
      (sum: number, item: any) =>
        sum + (item.unit_price ?? 0) * (item.quantity ?? 0),
      0,
    ),
    currency_code: cart.currency_code,
    created_at: cart.created_at,
    updated_at: cart.updated_at,
  }))

  return res.json({
    abandoned_checkouts: abandonedCheckouts,
    count: metadata?.count ?? abandonedCheckouts.length,
    limit,
    offset,
  })
}
