import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { Parcel2GoClient } from '../../../../../modules/parcel2go/client'

/**
 * GET /admin/orders/:id/shipping-label[?media=Label4X6|A4&format=PDF|PNG]
 *
 * Parcel2Go has no hosted label URL — GET /labels/{orderId} returns the label
 * as base64. To keep the existing `label_url` contract with the dashboard/POS
 * pages, the label is returned as a data: URI; those pages convert it to a
 * blob URL before window.open() (browsers block navigating to data: URLs).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id

  // `fulfillments` is linked in from the Fulfillment module via a Module
  // Link, so it can only be resolved through the Query module (same engine
  // the Admin REST API uses for `fields=*fulfillments`).
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query
    .graph({
      entity: 'order',
      filters: { id: orderId },
      fields: [
        'id',
        'fulfillments.id',
        'fulfillments.data',
        'fulfillments.canceled_at',
      ],
    })
    .catch(() => ({ data: [] }))

  const order: any = orders?.[0]

  if (!order) {
    return res.status(404).json({ error: `Order ${orderId} not found` })
  }

  const fulfillments = (order.fulfillments ?? []) as any[]
  const fulfillment = fulfillments.find(
    (f) => f?.data?.parcel2go_order_id && !f.canceled_at,
  )

  if (!fulfillment) {
    console.error(
      '[shipping-label] no fulfillment with parcel2go_order_id found. ' +
        'Raw fulfillments from Medusa:',
      JSON.stringify(fulfillments, null, 2),
    )
    return res.status(404).json({
      error:
        'No Parcel2Go shipment found on this order yet — the order must be marked as fulfilled first (that is what books the Parcel2Go shipment).',
    })
  }

  const parcel2goOrderId = fulfillment.data.parcel2go_order_id as string

  const clientId = process.env.PARCEL2GO_CLIENT_ID
  const clientSecret = process.env.PARCEL2GO_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error:
        'PARCEL2GO_CLIENT_ID / PARCEL2GO_CLIENT_SECRET are not configured on the server.',
    })
  }

  const client = new Parcel2GoClient({
    clientId,
    clientSecret,
    environment:
      (process.env.PARCEL2GO_ENVIRONMENT as 'live' | 'sandbox') || 'live',
    senderName: process.env.PARCEL2GO_SENDER_COMPANY_NAME,
  })

  const labelMedia = req.query.media === 'A4' ? 'A4' : 'Label4X6'
  const labelFormat = req.query.format === 'PNG' ? 'PNG' : 'PDF'

  try {
    const labels = await client.getLabels(parcel2goOrderId, {
      referenceType: 'OrderId',
      detailLevel: 'Labels',
      labelMedia,
      labelFormat,
    })

    const first = labels.Base64EncodedLabels?.find((l) => !!l)
    if (!first) {
      return res.status(502).json({
        error: 'Parcel2Go has not returned a label for this order yet.',
      })
    }

    const mime = labelFormat === 'PNG' ? 'image/png' : 'application/pdf'
    return res.json({
      label_url: `data:${mime};base64,${first}`,
      label_count: labels.SuccessfulLabels ?? 1,
      tracking_number: fulfillment.data.tracking_number ?? null,
      fulfillment_id: fulfillment.id,
    })
  } catch (err: any) {
    const body = err?.parcel2goError
    const detail = body?.Message ?? body?.ErrorCode ?? err?.message
    return res.status(502).json({
      error: `Failed to fetch label from Parcel2Go: ${detail ?? 'unknown error'}`,
    })
  }
}
