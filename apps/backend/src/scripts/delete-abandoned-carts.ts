/**
 * One-off cleanup script: permanently deletes abandoned carts (incomplete
 * carts with items, sitting untouched past a cutoff) from the database.
 *
 * Uses the exact same "abandoned" definition as
 * src/api/admin/abandoned-checkouts/route.ts — completed_at: null,
 * has items, updated_at older than `--minutes` (default 60).
 *
 * SAFE BY DEFAULT: running it with no flags only lists what WOULD be
 * deleted. Nothing is removed until you pass --confirm.
 *
 * Usage:
 *   npx medusa exec ./src/scripts/delete-abandoned-carts.ts
 *     -> dry run, just prints what it found
 *
 *   npx medusa exec ./src/scripts/delete-abandoned-carts.ts confirm
 *     -> actually deletes them (default: older than 60 min)
 *
 *   npx medusa exec ./src/scripts/delete-abandoned-carts.ts confirm 1440
 *     -> only delete carts abandoned for more than 24h (minutes as 2nd arg)
 *
 * NOTE: plain words (confirm / a number), not --flags — Medusa's own CLI
 * (yargs) sometimes swallows or rejects unknown --dashed flags before they
 * ever reach this script, which is inconsistent across environments.
 * Plain positional args always reach `args` reliably.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

export default async function deleteAbandonedCarts({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const cartModuleService = container.resolve(Modules.CART)

  const confirm = args.includes('confirm')
  const minutesArg = args.find((a) => /^\d+$/.test(a))
  const minutes = minutesArg ? Number(minutesArg) : 60
  const cutoff = new Date(Date.now() - minutes * 60 * 1000)

  const limit = 1000
  let offset = 0
  let totalCount = 0
  const allIds: string[] = []
  let totalValue = 0

  do {
    const { data: carts, metadata } = await query.graph({
      entity: 'cart',
      fields: ['id', 'email', 'currency_code', 'updated_at', 'items.*'],
      filters: {
        completed_at: null,
        updated_at: { $lt: cutoff },
      },
      pagination: {
        skip: offset,
        take: limit,
      },
    })

    totalCount = metadata?.count ?? carts.length

    const withItems = carts.filter((cart: any) => (cart.items?.length ?? 0) > 0)
    for (const cart of withItems) {
      allIds.push(cart.id)
      totalValue += (cart.items ?? []).reduce(
        (sum: number, item: any) =>
          sum + (item.unit_price ?? 0) * (item.quantity ?? 0),
        0,
      )
    }

    offset += limit
  } while (offset < totalCount)

  if (allIds.length === 0) {
    logger.info(
      `No abandoned carts found older than ${minutes} minutes. Nothing to do.`,
    )
    return
  }

  logger.info(
    `Found ${allIds.length} abandoned cart(s) older than ${minutes} minutes ` +
      `(combined cart value ≈ ${totalValue.toFixed(2)}).`,
  )

  if (!confirm) {
    logger.info(
      'Dry run — nothing deleted. Re-run with "confirm" as an argument to actually delete these carts:',
    )
    logger.info(allIds.join(', '))
    return
  }

  // Delete one at a time rather than in a single batch call — if even one
  // ID is somehow already gone (stale reference, a partial failed cleanup
  // attempt elsewhere, a race with something else), a single batch call
  // throws "not_found" and aborts the WHOLE run, deleting nothing. Doing
  // it one by one means a single bad ID is skipped and logged instead of
  // blocking the other 23+ good ones.
  let deleted = 0
  let failed = 0
  for (const id of allIds) {
    try {
      await cartModuleService.deleteCarts([id])
      deleted++
    } catch (err: any) {
      failed++
      logger.warn(`Skipped ${id}: ${err?.message ?? err}`)
    }
  }

  logger.info(
    `Deleted ${deleted} abandoned cart(s).${failed ? ` ${failed} skipped (see warnings above).` : ''}`,
  )
}
