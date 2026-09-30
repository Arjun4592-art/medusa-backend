import type { MedusaContainer } from '@medusajs/framework/types'
import {
  loadOrderFulfillments,
  syncFulfillmentTracking,
} from '../modules/parcel2go/tracking'

export default async function syncCourierTracking(container: MedusaContainer) {
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
  const orders = await loadOrderFulfillments(container, {
    created_at: { $gte: since },
  })

  let checked = 0
  let delivered = 0
  for (const order of orders) {
    for (const f of order.fulfillments ?? []) {
      if (!f?.data?.parcel2go_order_id) continue
      if (!f.shipped_at || f.delivered_at || f.canceled_at) continue
      try {
        const r = await syncFulfillmentTracking(container, f, order.id)
        checked++
        if (r?.markedDelivered) delivered++
      } catch (err: any) {
        console.error(
          `[courier-tracking] sync failed for order ${order.id} / fulfillment ${f.id}:`,
          err?.message ?? err,
        )
      }
    }
  }
  console.log(
    `[courier-tracking] checked ${checked} shipment(s), auto-marked ${delivered} delivered`,
  )
}

export const config = {
  name: 'sync-courier-tracking',
  schedule: '*/30 * * * *',
}
