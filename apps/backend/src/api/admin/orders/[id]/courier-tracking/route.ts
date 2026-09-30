import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import {
  loadOrderFulfillments,
  syncFulfillmentTracking,
} from '../../../../../modules/parcel2go/tracking'

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id
  const orders = await loadOrderFulfillments(req.scope, { id: orderId }, 1)
  const order = orders[0]
  if (!order) {
    return res.status(404).json({ error: `Order ${orderId} not found` })
  }
  const fulfillment = (order.fulfillments ?? []).find(
    (f: any) => f?.data?.parcel2go_order_id && !f.canceled_at,
  )
  if (!fulfillment) {
    return res.status(404).json({
      error: 'No Parcel2Go shipment found on this order yet.',
    })
  }
  try {
    const result = await syncFulfillmentTracking(
      req.scope,
      fulfillment,
      orderId,
    )
    if (!result) {
      return res.status(500).json({
        error:
          'PARCEL2GO_CLIENT_ID / PARCEL2GO_CLIENT_SECRET are not configured.',
      })
    }
    return res.json({ tracking: result })
  } catch (err: any) {
    const detail = err?.parcel2goError?.Message ?? err?.message
    return res.status(502).json({
      error: `Could not fetch courier tracking: ${detail ?? 'unknown error'}`,
    })
  }
}
