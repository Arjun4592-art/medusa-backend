import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http'
import { FAVORITES_MODULE } from '../../../modules/favorites'
import type FavoritesModuleService from '../../../modules/favorites/service'
import { MAX_WISHLIST_ITEMS } from '../../../modules/favorites/constants'

type Body = { add?: unknown; remove?: unknown; clear?: unknown }

function toIdList(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  if (value.length > MAX_WISHLIST_ITEMS) return null
  if (!value.every((v) => typeof v === 'string' && v.length > 0)) return null
  return Array.from(new Set(value as string[]))
}

async function listIds(svc: FavoritesModuleService, customerId: string) {
  const rows = await svc.listWishlistItems(
    { customer_id: customerId },
    { order: { created_at: 'ASC' }, take: null },
  )
  return rows.map((r) => r.product_id)
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) return res.status(401).json({ error: 'Unauthorized' })
  const svc: FavoritesModuleService = req.scope.resolve(FAVORITES_MODULE)
  res.json({ productIds: await listIds(svc, customerId) })
}

// Applies a change set. It never replaces the whole list, so a stale browser
// tab cannot wipe items another device added.
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) return res.status(401).json({ error: 'Unauthorized' })

  const body = (req.body ?? {}) as Body
  const add = toIdList(body.add)
  const remove = toIdList(body.remove)
  if (add === null || remove === null) {
    return res.status(400).json({
      error: `add/remove must be arrays of product ids (max ${MAX_WISHLIST_ITEMS})`,
    })
  }

  const svc: FavoritesModuleService = req.scope.resolve(FAVORITES_MODULE)

  if (body.clear === true) {
    await svc.deleteWishlistItems({ customer_id: customerId })
  } else if (remove.length) {
    await svc.deleteWishlistItems({
      customer_id: customerId,
      product_id: remove,
    })
  }

  if (add.length) {
    const existing = new Set(await listIds(svc, customerId))
    const toCreate = add.filter((id) => !existing.has(id))
    if (existing.size + toCreate.length > MAX_WISHLIST_ITEMS) {
      return res
        .status(400)
        .json({ error: `Wishlist is limited to ${MAX_WISHLIST_ITEMS} items` })
    }
    if (toCreate.length) {
      try {
        await svc.createWishlistItems(
          toCreate.map((product_id) => ({
            customer_id: customerId,
            product_id,
          })),
        )
      } catch (err: any) {
        // A parallel request already inserted some of these - not an error.
        if (!(
          err?.code === '23505' || /unique|duplicate/i.test(err?.message ?? '')
        )) {
          throw err
        }
      }
    }
  }

  res.json({ success: true, productIds: await listIds(svc, customerId) })
}
