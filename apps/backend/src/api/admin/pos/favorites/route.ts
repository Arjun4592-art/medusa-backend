import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { FAVORITES_MODULE } from '../../../../modules/favorites'
import type FavoritesModuleService from '../../../../modules/favorites/service'
import {
  CUSTOM_TAB_ID_RE,
  DEFAULT_FAVORITE_TABS,
  MAX_CUSTOM_TABS,
  MAX_FAVORITES_PER_TAB,
  MAX_TAB_LABEL_LENGTH,
  type FavoriteTab,
} from '../../../../modules/favorites/constants'

type FavoritesMap = Record<string, string[]>

type Body = {
  action?: string
  tab?: unknown
  productId?: unknown
  label?: unknown
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TAB_LABEL_LENGTH)
}

function labelExists(tabs: FavoriteTab[], label: string, excludeId?: string) {
  const needle = label.toLowerCase()
  return tabs.some(
    (t) => t.id !== excludeId && t.label.toLowerCase() === needle,
  )
}

function newCustomTabKey(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const key = `custom-${Date.now().toString(36)}${rand}`
  return CUSTOM_TAB_ID_RE.test(key) ? key : `custom-${rand}${rand}`
}

function isUniqueViolation(err: any): boolean {
  return err?.code === '23505' || /unique|duplicate/i.test(err?.message ?? '')
}

async function loadState(svc: FavoritesModuleService) {
  const [customTabs, rows] = await Promise.all([
    svc.listPosFavoriteTabs({}, { order: { created_at: 'ASC' }, take: null }),
    svc.listPosFavorites(
      {},
      { order: { position: 'ASC', created_at: 'ASC' }, take: null },
    ),
  ])
  const tabs: FavoriteTab[] = [
    ...DEFAULT_FAVORITE_TABS.map((t) => ({ ...t })),
    ...customTabs.map((t) => ({ id: t.tab_key, label: t.label, custom: true })),
  ]
  const favorites: FavoritesMap = {}
  for (const t of tabs) favorites[t.id] = []
  for (const r of rows) favorites[r.tab_key]?.push(r.product_id)
  return { tabs, favorites, customTabRows: customTabs }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc: FavoritesModuleService = req.scope.resolve(FAVORITES_MODULE)
  const { tabs, favorites } = await loadState(svc)
  res.json({ favorites, tabs })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const svc: FavoritesModuleService = req.scope.resolve(FAVORITES_MODULE)
  const { action, tab, productId, label } = (req.body ?? {}) as Body
  const fail = (error: string, status = 400) =>
    res.status(status).json({ error })

  const state = await loadState(svc)
  const { tabs, favorites, customTabRows } = state
  let createdTabId: string | undefined

  if (action === 'pin' || action === 'unpin') {
    if (typeof tab !== 'string' || !tabs.some((t) => t.id === tab)) {
      return fail('Invalid tab')
    }
    if (typeof productId !== 'string' || !productId) {
      return fail('productId required')
    }
    if (action === 'pin') {
      const list = favorites[tab]
      if (!list.includes(productId)) {
        if (list.length >= MAX_FAVORITES_PER_TAB) {
          return fail(`This tab already has ${MAX_FAVORITES_PER_TAB} favorites`)
        }
        try {
          await svc.createPosFavorites({
            tab_key: tab,
            product_id: productId,
            position: list.length,
          })
        } catch (err) {
          // A concurrent identical pin already inserted it - that's fine.
          if (!isUniqueViolation(err)) throw err
        }
      }
    } else {
      await svc.deletePosFavorites({ tab_key: tab, product_id: productId })
    }
  } else if (action === 'addTab') {
    const cleanLabel = normalizeLabel(label)
    if (!cleanLabel) return fail('Enter a tab name')
    if (labelExists(tabs, cleanLabel)) {
      return fail('A tab with that name already exists')
    }
    if (tabs.filter((t) => t.custom).length >= MAX_CUSTOM_TABS) {
      return fail(`You can add up to ${MAX_CUSTOM_TABS} custom tabs`)
    }
    if (
      productId !== undefined &&
      (typeof productId !== 'string' || !productId)
    ) {
      return fail('Invalid productId')
    }
    createdTabId = newCustomTabKey()
    await svc.createPosFavoriteTabs({
      tab_key: createdTabId,
      label: cleanLabel,
    })
    if (typeof productId === 'string') {
      await svc.createPosFavorites({
        tab_key: createdTabId,
        product_id: productId,
        position: 0,
      })
    }
  } else if (action === 'renameTab') {
    const target = tabs.find((t) => t.id === tab)
    if (!target) return fail('Tab not found', 404)
    if (!target.custom) return fail('Built-in tabs cannot be renamed')
    const cleanLabel = normalizeLabel(label)
    if (!cleanLabel) return fail('Enter a tab name')
    if (labelExists(tabs, cleanLabel, target.id)) {
      return fail('A tab with that name already exists')
    }
    const row = customTabRows.find((r) => r.tab_key === target.id)
    if (!row) return fail('Tab not found', 404)
    await svc.updatePosFavoriteTabs({ id: row.id, label: cleanLabel })
  } else if (action === 'deleteTab') {
    const target = tabs.find((t) => t.id === tab)
    if (!target) return fail('Tab not found', 404)
    if (!target.custom) return fail('Built-in tabs cannot be deleted')
    const row = customTabRows.find((r) => r.tab_key === target.id)
    if (!row) return fail('Tab not found', 404)
    await svc.deletePosFavorites({ tab_key: target.id })
    await svc.deletePosFavoriteTabs(row.id)
  } else {
    return fail('Invalid action')
  }

  const after = await loadState(svc)
  res.json({
    favorites: after.favorites,
    tabs: after.tabs,
    tabId: createdTabId,
  })
}
