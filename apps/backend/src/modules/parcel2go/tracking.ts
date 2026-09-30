import type { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { markOrderFulfillmentAsDeliveredWorkflow } from '@medusajs/medusa/core-flows'
import { Parcel2GoClient } from './client'
import {
  addBusinessDays,
  pickEstimatedDelivery,
  type EstimatedDelivery,
} from './estimate'

export { addBusinessDays, pickEstimatedDelivery }

export type CourierEvent = {
  at: string
  text: string
  code?: string
  details?: string
}

export type TrackingResult = {
  fulfillmentId: string
  orderId: string
  events: CourierEvent[]
  status: string | null
  collectedAt: string | null
  outForDeliveryAt: string | null
  deliveredAt: string | null
  estimatedDelivery: string | null
  markedDelivered: boolean
}

const DELIVERED_BLOCK = [
  'outfordelivery',
  'attempt',
  'failed',
  'notdelivered',
  'undelivered',
  'tobedelivered',
  'willbedelivered',
  'awaitingdelivery',
  'deliverydate',
  'redeliver',
  'deliveryscheduled',
]
const COLLECTED_BLOCK = [
  'awaiting',
  'tobecollected',
  'willbecollected',
  'booked',
  'labelcreated',
  'notcollected',
  'collectionfailed',
]
const COLLECTED_HINT = [
  'collected',
  'pickedup',
  'intransit',
  'depot',
  'hub',
  'sorting',
  'dispatched',
  'onitsway',
  'accepted',
  'itemreceived',
  'receivedby',
  'receivedat',
]

function flat(e: CourierEvent) {
  return `${e.code ?? ''} ${e.text}`.toLowerCase().replace(/[^a-z]+/g, '')
}

export function isDeliveredEvent(e: CourierEvent) {
  const f = flat(e)
  return f.includes('delivered') && !DELIVERED_BLOCK.some((b) => f.includes(b))
}

export function isOutForDeliveryEvent(e: CourierEvent) {
  const f = flat(e)
  return f.includes('outfordelivery') || f.includes('duetobedeliveredtoday')
}

export function isCollectedEvent(e: CourierEvent) {
  const f = flat(e)
  return (
    COLLECTED_HINT.some((h) => f.includes(h)) &&
    !COLLECTED_BLOCK.some((b) => f.includes(b))
  )
}

export function makeClient() {
  const clientId = process.env.PARCEL2GO_CLIENT_ID
  const clientSecret = process.env.PARCEL2GO_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return new Parcel2GoClient({
    clientId,
    clientSecret,
    environment:
      (process.env.PARCEL2GO_ENVIRONMENT as 'live' | 'sandbox') || 'live',
    senderName: process.env.PARCEL2GO_SENDER_COMPANY_NAME,
  })
}

export function normalizeEvents(res: {
  Results?: Array<{
    Timestamp: string
    Description: string
    Details?: string
    StatusCode?: string
  }>
}): CourierEvent[] {
  return (res.Results ?? [])
    .filter((r) => !!r.Timestamp)
    .map((r) => ({
      at: r.Timestamp,
      text: r.Description ?? '',
      code: r.StatusCode,
      details: r.Details,
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

export type TrackingAttempt = { id: string; ok: boolean; error?: string }

function errMessage(err: any) {
  return String(err?.parcel2goError?.Message ?? err?.message ?? err)
}

export async function fetchCourierEvents(
  client: Parcel2GoClient,
  parcel2goOrderId: string,
  data: Record<string, any> = {},
) {
  const candidates: string[] = []
  const add = (v: unknown) => {
    if (v == null) return
    const id = String(v).trim()
    if (id && !candidates.includes(id)) candidates.push(id)
  }
  add(data.parcel2go_tracking_id)
  add(data.parcel2go_ref)
  if (data.parcel2go_ref) add(String(data.parcel2go_ref).replace(/^P2G/i, ''))
  add(parcel2goOrderId)
  if (/^\d+$/.test(String(parcel2goOrderId))) add(`P2G${parcel2goOrderId}`)
  add(data.tracking_number)
  try {
    const nums = await client.getParcelNumbers(parcel2goOrderId)
    for (const t of nums.TrackingNumbers ?? []) add(t.TrackingNumber)
  } catch {}

  const attempts: TrackingAttempt[] = []
  for (const id of candidates) {
    try {
      const res = await client.getTracking(id)
      attempts.push({ id, ok: true })
      return { lineId: id, events: normalizeEvents(res), attempts }
    } catch (err) {
      attempts.push({ id, ok: false, error: errMessage(err) })
    }
  }
  return { lineId: undefined, events: [] as CourierEvent[], attempts }
}

export async function syncFulfillmentTracking(
  container: MedusaContainer,
  fulfillment: any,
  orderId: string,
): Promise<TrackingResult | null> {
  const client = makeClient()
  if (!client) return null
  const data: Record<string, any> = fulfillment.data ?? {}
  const parcel2goOrderId = data.parcel2go_order_id
  if (!parcel2goOrderId) return null

  const { lineId, events, attempts } = await fetchCourierEvents(
    client,
    String(parcel2goOrderId),
    data,
  )
  if (!lineId) {
    throw new Error(
      `Parcel2Go tracking lookup failed for ids: ${attempts
        .map((a) => `${a.id} (${a.error})`)
        .join('; ')}`,
    )
  }

  const last = events[events.length - 1]
  const collectedAt = events.find(isCollectedEvent)?.at ?? null
  const outForDeliveryAt =
    [...events].reverse().find(isOutForDeliveryEvent)?.at ?? null
  const deliveredAt = [...events].reverse().find(isDeliveredEvent)?.at ?? null

  const patch: Record<string, any> = {
    ...(lineId ? { parcel2go_tracking_id: lineId } : {}),
    courier_events: events.slice(-20),
    courier_status: last?.text ?? data.courier_status ?? null,
    courier_status_at: last?.at ?? data.courier_status_at ?? null,
    courier_collected_at: collectedAt ?? data.courier_collected_at ?? null,
    courier_out_for_delivery_at:
      outForDeliveryAt ?? data.courier_out_for_delivery_at ?? null,
    courier_delivered_at: deliveredAt ?? data.courier_delivered_at ?? null,
    courier_synced_at: new Date().toISOString(),
  }

  const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as any
  await fulfillmentModule.updateFulfillment(fulfillment.id, {
    data: { ...data, ...patch },
  })

  let markedDelivered = false
  if (
    patch.courier_delivered_at &&
    fulfillment.shipped_at &&
    !fulfillment.delivered_at
  ) {
    await markOrderFulfillmentAsDeliveredWorkflow(container).run({
      input: { orderId, fulfillmentId: fulfillment.id },
    })
    markedDelivered = true
    await notifyStorefrontDelivered(orderId)
  }

  return {
    fulfillmentId: fulfillment.id,
    orderId,
    events: patch.courier_events,
    status: patch.courier_status,
    collectedAt: patch.courier_collected_at,
    outForDeliveryAt: patch.courier_out_for_delivery_at,
    deliveredAt: patch.courier_delivered_at,
    estimatedDelivery: data.estimated_delivery ?? null,
    markedDelivered,
  }
}

async function notifyStorefrontDelivered(orderId: string) {
  const url = process.env.STOREFRONT_URL
  const secret = process.env.COURIER_WEBHOOK_SECRET
  if (!url || !secret) return
  try {
    await fetch(`${url.replace(/\/$/, '')}/api/webhooks/courier-delivered`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-courier-secret': secret,
      },
      body: JSON.stringify({ orderId }),
    })
  } catch (err) {
    console.error(
      '[courier-tracking] storefront delivered webhook failed:',
      err,
    )
  }
}

export async function loadOrderFulfillments(
  container: MedusaContainer,
  filters: Record<string, unknown>,
  take = 200,
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'order',
    filters,
    fields: [
      'id',
      'fulfillments.id',
      'fulfillments.data',
      'fulfillments.shipped_at',
      'fulfillments.delivered_at',
      'fulfillments.canceled_at',
    ],
    pagination: { take, order: { created_at: 'DESC' } },
  })
  return data as any[]
}
