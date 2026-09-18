import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'
import type { IOrderModuleService } from '@medusajs/framework/types'
import { RoyalMailClient } from '../../../../../modules/royal-mail/client'

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id

  const orderModuleService: IOrderModuleService = req.scope.resolve(
    Modules.ORDER,
  )

  const order: any = await orderModuleService
    .retrieveOrder(orderId, {
      relations: ['fulfillments'],
    })
    .catch(() => null)

  if (!order) {
    return res.status(404).json({ error: `Order ${orderId} not found` })
  }

  const fulfillments = (order.fulfillments ?? []) as any[]
  const fulfillment = fulfillments.find(
    (f) => f?.data?.royal_mail_order_id && !f.canceled_at,
  )

  if (!fulfillment) {
    return res.status(404).json({
      error:
        'No Royal Mail shipment found on this order yet — the order must be marked as fulfilled first (that is what books the Royal Mail shipment).',
    })
  }

  const royalMailOrderId = fulfillment.data.royal_mail_order_id as string

  const apiKey = process.env.ROYAL_MAIL_CLICK_DROP_API_KEY
  if (!apiKey) {
    return res.status(500).json({
      error: 'ROYAL_MAIL_CLICK_DROP_API_KEY is not configured on the server.',
    })
  }

  const client = new RoyalMailClient({
    apiKey,
    tradingName: process.env.ROYAL_MAIL_TRADING_NAME,
  })

  try {
    const { url } = await client.getLabel(royalMailOrderId)
    return res.json({
      label_url: url,
      tracking_number: fulfillment.data.tracking_number ?? null,
      fulfillment_id: fulfillment.id,
    })
  } catch (err: any) {
    return res.status(502).json({
      error: `Failed to fetch label from Royal Mail: ${err?.message ?? 'unknown error'}`,
    })
  }
}
