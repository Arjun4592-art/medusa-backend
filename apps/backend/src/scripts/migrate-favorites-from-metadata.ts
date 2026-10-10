import type { ExecArgs } from '@medusajs/framework/types'
import { Modules } from '@medusajs/framework/utils'
import { FAVORITES_MODULE } from '../modules/favorites'
import type FavoritesModuleService from '../modules/favorites/service'
import {
  CUSTOM_TAB_ID_RE,
  DEFAULT_FAVORITE_TABS,
  MAX_CUSTOM_TABS,
  MAX_FAVORITES_PER_TAB,
  MAX_TAB_LABEL_LENGTH,
  MAX_WISHLIST_ITEMS,
} from '../modules/favorites/constants'

/**
 * One-off, safe to re-run: copies the old metadata-based favorites into the
 * new tables.
 *   - store.metadata.posFavoriteTabs / posFavorites  -> pos_favorite_tab / pos_favorite
 *   - customer.metadata.wishlist                      -> wishlist_item
 * The old metadata is left untouched so you can roll back.
 *
 * Run:  npx medusa exec ./src/scripts/migrate-favorites-from-metadata.ts
 */
export default async function migrateFavorites({ container }: ExecArgs) {
  const logger = container.resolve('logger')
  const svc: FavoritesModuleService = container.resolve(FAVORITES_MODULE)
  const storeModule = container.resolve(Modules.STORE)
  const customerModule = container.resolve(Modules.CUSTOMER)

  // ---------- POS favorites ----------
  const [store] = await storeModule.listStores({}, { take: 1 })
  const meta = (store?.metadata ?? {}) as Record<string, unknown>

  const builtInIds = new Set(DEFAULT_FAVORITE_TABS.map((t) => t.id))
  const existingTabs = await svc.listPosFavoriteTabs({}, { take: null })
  const knownTabKeys = new Set<string>([
    ...builtInIds,
    ...existingTabs.map((t) => t.tab_key),
  ])
  const usedLabels = new Set<string>([
    ...DEFAULT_FAVORITE_TABS.map((t) => t.label.toLowerCase()),
    ...existingTabs.map((t) => t.label.toLowerCase()),
  ])

  let tabsCreated = 0
  const rawTabs = Array.isArray(meta.posFavoriteTabs)
    ? meta.posFavoriteTabs
    : []
  for (const item of rawTabs) {
    if (existingTabs.length + tabsCreated >= MAX_CUSTOM_TABS) break
    const { id, label } = (item ?? {}) as Record<string, unknown>
    const clean =
      typeof label === 'string'
        ? label.replace(/\s+/g, ' ').trim().slice(0, MAX_TAB_LABEL_LENGTH)
        : ''
    if (typeof id !== 'string' || !CUSTOM_TAB_ID_RE.test(id)) continue
    if (!clean || knownTabKeys.has(id) || usedLabels.has(clean.toLowerCase())) {
      continue
    }
    await svc.createPosFavoriteTabs({ tab_key: id, label: clean })
    knownTabKeys.add(id)
    usedLabels.add(clean.toLowerCase())
    tabsCreated++
  }

  let pinsCreated = 0
  const rawFavs =
    meta.posFavorites && typeof meta.posFavorites === 'object'
      ? (meta.posFavorites as Record<string, unknown>)
      : {}
  for (const tabKey of knownTabKeys) {
    const list = rawFavs[tabKey]
    if (!Array.isArray(list)) continue
    const existing = await svc.listPosFavorites(
      { tab_key: tabKey },
      { take: null },
    )
    const have = new Set(existing.map((r) => r.product_id))
    let position = existing.length
    for (const pid of list) {
      if (typeof pid !== 'string' || !pid || have.has(pid)) continue
      if (position >= MAX_FAVORITES_PER_TAB) break
      await svc.createPosFavorites({
        tab_key: tabKey,
        product_id: pid,
        position: position++,
      })
      have.add(pid)
      pinsCreated++
    }
  }
  logger.info(
    `[favorites] POS: ${tabsCreated} custom tab(s), ${pinsCreated} pin(s) copied`,
  )

  // ---------- Customer wishlists ----------
  let customersTouched = 0
  let itemsCreated = 0
  const PAGE = 200
  for (let skip = 0; ; skip += PAGE) {
    const [customers, count] = await customerModule.listAndCountCustomers(
      {},
      { select: ['id', 'metadata'], skip, take: PAGE },
    )
    for (const c of customers) {
      const wl = (c.metadata as Record<string, unknown> | null)?.wishlist
      if (!Array.isArray(wl) || !wl.length) continue
      const existing = await svc.listWishlistItems(
        { customer_id: c.id },
        { take: null },
      )
      const have = new Set(existing.map((r) => r.product_id))
      const toCreate = Array.from(
        new Set(wl.filter((p): p is string => typeof p === 'string' && !!p)),
      )
        .filter((p) => !have.has(p))
        .slice(0, Math.max(0, MAX_WISHLIST_ITEMS - have.size))
      if (!toCreate.length) continue
      await svc.createWishlistItems(
        toCreate.map((product_id) => ({ customer_id: c.id, product_id })),
      )
      customersTouched++
      itemsCreated += toCreate.length
    }
    if (skip + PAGE >= count) break
  }
  logger.info(
    `[favorites] Wishlist: ${itemsCreated} item(s) copied for ${customersTouched} customer(s)`,
  )
}
