import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import {
  Parcel2GoClient,
  Parcel2GoOrderAddress,
  extractQuoteOptions,
  splitAddressLine,
  toIso3,
} from '../../../../../modules/parcel2go/client'
import {
  TIERS,
  fallbackSlug,
  pickTier,
  toQty,
} from '../../../../../modules/parcel2go/shipping-tier'

/**
 * POST /admin/orders/:id/return-label
 * Body: { items: [{ item_id: string; quantity: number }] }
 *
 * Books a REAL Parcel2Go collection (courier picks up from the customer) for
 * a shipped order's return, and returns the tracking number + cost. This is
 * for shipped orders only — store-pickup/local returns don't need a courier
 * and should never call this.
 *
 * This does NOT go through Medusa's fulfillment/returns module (no Return or
 * Fulfillment record is created) — it is a standalone booking used by the
 * POS/Dashboard return flow, which tracks everything itself in the order's
 * `metadata.returns` array. Kept deliberately separate from
 * Parcel2GoFulfillmentProviderService.createReturnFulfillment (used only
 * when a Medusa Return with a "Parcel2Go Return" shipping option is created)
 * so the two flows don't fight over the same order.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id
  const body = (req.body ?? {}) as {
    items?: { item_id: string; quantity: number }[]
  }
  const requestedItems = body.items ?? []
  if (!requestedItems.length) {
    return res.status(400).json({ error: 'items is required' })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query
    .graph({
      entity: 'order',
      filters: { id: orderId },
      fields: [
        'id',
        'email',
        'items.id',
        'items.title',
        'items.product_title',
        'items.product_type',
        'shipping_address.first_name',
        'shipping_address.last_name',
        'shipping_address.address_1',
        'shipping_address.address_2',
        'shipping_address.city',
        'shipping_address.province',
        'shipping_address.postal_code',
        'shipping_address.country_code',
        'shipping_address.phone',
      ],
    })
    .catch(() => ({ data: [] }))

  const order: any = orders?.[0]
  if (!order) {
    return res.status(404).json({ error: `Order ${orderId} not found` })
  }
  const address = order.shipping_address
  if (!address?.postal_code) {
    return res.status(400).json({
      error: 'Order has no shipping address — cannot book a collection.',
    })
  }

  const itemsById = new Map((order.items ?? []).map((i: any) => [i.id, i]))
  const enriched = requestedItems.map((r) => {
    const line: any = itemsById.get(r.item_id)
    return {
      title: [line?.product_title, line?.title].filter(Boolean).join(' '),
      productType: line?.product_type as string | undefined,
      quantity: toQty(r.quantity),
    }
  })

  const CATEGORY_WEIGHT_FALLBACKS: Array<{ pattern: RegExp; grams: number }> = [
    { pattern: /shoe|trainer|footwear/i, grams: 900 },
    { pattern: /racket|racquet/i, grams: 300 },
    { pattern: /squash/i, grams: 250 },
    { pattern: /bag|kit ?bag|backpack/i, grams: 700 },
    { pattern: /grip|damp|headband|wristband/i, grams: 40 },
    { pattern: /sock/i, grams: 80 },
    { pattern: /ball|\btin\b|\bcan\b/i, grams: 260 },
    { pattern: /shuttlecock|shuttle/i, grams: 150 },
    { pattern: /shirt|short|jacket|top/i, grams: 200 },
  ]
  const weightKg =
    enriched.reduce((sum, i) => {
      const match = CATEGORY_WEIGHT_FALLBACKS.find((c) =>
        c.pattern.test(i.title),
      )
      return sum + (match?.grams ?? 300) * i.quantity
    }, 0) / 1000 || 0.3

  // Customer returns are drop-off only (they take the parcel to a shop
  // themselves) — same tiers/slugs used for outbound, not Collection ones.
  const tier = pickTier(enriched, weightKg)
  const returnTier = TIERS[tier.id]

  const line1 = process.env.RETURN_ADDRESS_LINE1
  const town = process.env.RETURN_ADDRESS_CITY
  const postcode = process.env.RETURN_ADDRESS_POSTCODE
  if (!line1 || !town || !postcode) {
    return res.status(500).json({
      error:
        '[parcel2go] Missing RETURN_ADDRESS_LINE1 / _CITY / _POSTCODE env vars.',
    })
  }
  const senderEmail = process.env.PARCEL2GO_SENDER_EMAIL
  const senderPhone = process.env.PARCEL2GO_SENDER_PHONE
  if (!senderEmail) {
    return res
      .status(500)
      .json({ error: '[parcel2go] PARCEL2GO_SENDER_EMAIL is not set.' })
  }

  const clientId = process.env.PARCEL2GO_CLIENT_ID
  const clientSecret = process.env.PARCEL2GO_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return res
      .status(500)
      .json({ error: '[parcel2go] Missing PARCEL2GO_CLIENT_ID/SECRET.' })
  }
  const client = new Parcel2GoClient({
    clientId,
    clientSecret,
    environment:
      (process.env.PARCEL2GO_ENVIRONMENT as 'live' | 'sandbox') || 'live',
    senderName: process.env.PARCEL2GO_SENDER_COMPANY_NAME,
  })

  const toAddr = (a: {
    name: string
    line1: string
    line2?: string | null
    town: string
    county?: string | null
    postcode: string
    countryCode?: string | null
    phone?: string | null
    email?: string | null
    company?: string | null
  }): Parcel2GoOrderAddress => {
    const { property, street } = splitAddressLine(a.line1, a.line2 ?? undefined)
    return {
      ContactName: a.name || 'Customer',
      Organisation: a.company || undefined,
      Email: a.email || undefined,
      Phone: a.phone || undefined,
      Property: property,
      Street: street,
      Town: a.town,
      County: a.county || undefined,
      Postcode: a.postcode,
      CountryIsoCode: toIso3(a.countryCode),
      CountryId: 0,
    }
  }

  const first = address.first_name ?? ''
  const last = address.last_name ?? ''
  const collectionAddr = toAddr({
    name: `${first} ${last}`.trim(),
    line1: address.address_1 ?? '',
    line2: address.address_2,
    town: address.city ?? '',
    county: address.province,
    postcode: address.postal_code ?? '',
    countryCode: address.country_code,
    phone: address.phone || senderPhone,
    email: order.email || senderEmail,
  })
  const deliveryAddr = toAddr({
    name: `${process.env.RETURN_ADDRESS_FIRST_NAME || 'Returns'} ${process.env.RETURN_ADDRESS_LAST_NAME || 'Department'}`.trim(),
    company: process.env.RETURN_ADDRESS_COMPANY,
    line1,
    line2: process.env.RETURN_ADDRESS_LINE2,
    town,
    postcode,
    countryCode: process.env.RETURN_ADDRESS_COUNTRY_ISO || 'GB',
  })

  try {
    const quoteRes = await client.getQuotes({
      CollectionAddress: {
        Country: collectionAddr.CountryIsoCode,
        Property: collectionAddr.Property,
        Postcode: collectionAddr.Postcode,
        Town: collectionAddr.Town,
        VatStatus: 'Individual',
      },
      DeliveryAddress: {
        Country: deliveryAddr.CountryIsoCode,
        Property: deliveryAddr.Property,
        Postcode: deliveryAddr.Postcode,
        Town: deliveryAddr.Town,
        VatStatus: 'Individual',
      },
      Parcels: [{ Value: 50, Weight: weightKg, ...returnTier.parcel }],
    })
    const options = extractQuoteOptions(quoteRes)
    const matched =
      options.find((o) => o.slug === returnTier.standardSlug) ??
      options.find((o) => o.slug === fallbackSlug(false))
    if (!matched) {
      return res.status(422).json({
        error: `[parcel2go] No return collection service offered for ${collectionAddr.Postcode}. Offered: ${options.map((o) => o.slug).join(', ') || 'none'}.`,
      })
    }

    const dates = await client.getCollectionDates({
      serviceSlug: matched.slug,
      address: `${collectionAddr.Property} ${collectionAddr.Street}`.trim(),
      city: collectionAddr.Town,
      postcode: collectionAddr.Postcode,
      countryIso3: collectionAddr.CountryIsoCode,
    })
    const collectionDate = dates.CollectionDates?.[0]?.CollectionDate
    if (!collectionDate) {
      return res.status(422).json({
        error: `[parcel2go] No collection date available for ${matched.slug}.`,
      })
    }

    const prepayBalance = await client.getPrepayBalance().catch(() => null)
    if (prepayBalance !== null && prepayBalance < matched.price) {
      return res.status(402).json({
        error: `[parcel2go] Prepay balance (£${prepayBalance.toFixed(2)}) is lower than the return cost (£${matched.price.toFixed(2)}, ${matched.name}). Top up Prepay and try again.`,
      })
    }

    const [bookerForename, ...bookerRest] = (
      process.env.PARCEL2GO_SENDER_NAME || 'Warehouse Team'
    ).split(' ')
    const created = await client.createOrder({
      Items: [
        {
          Id: crypto.randomUUID(),
          CollectionDate: collectionDate,
          Service: matched.slug,
          OriginCountry: collectionAddr.CountryIsoCode,
          VatStatus: 'Individual',
          RecipientVatStatus: 'Individual',
          Parcels: [
            {
              Id: '00000000-0000-0000-0000-000000000000',
              Height: returnTier.parcel.Height,
              Length: returnTier.parcel.Length,
              Width: returnTier.parcel.Width,
              Weight: weightKg,
              EstimatedValue: 50,
              DeliveryAddress: deliveryAddr,
              ContentsSummary: 'Returned sports goods',
            },
          ],
          CollectionAddress: collectionAddr,
        },
      ],
      CustomerDetails: {
        Email: senderEmail,
        Forename: bookerForename,
        Surname: bookerRest.join(' ') || 'Team',
      },
    })
    const p2gOrderId = String(created.OrderId)
    await client.payOrderWithPrepay(p2gOrderId)
    const parcels = await client.getParcelNumbers(p2gOrderId).catch(() => ({
      TrackingNumbers: [],
    }))
    const trackingNumber =
      parcels.TrackingNumbers?.find((t) => !!t.TrackingNumber)
        ?.TrackingNumber ?? undefined

    console.log(
      `[parcel2go] RETURN LABEL order=${orderId} tier=${tier.id} slug=${matched.slug} price=£${matched.price.toFixed(2)} tracking=${trackingNumber ?? 'pending'}`,
    )

    return res.status(200).json({
      parcel2go_order_id: p2gOrderId,
      tracking_number: trackingNumber,
      service_name: matched.name,
      price: matched.price,
    })
  } catch (err: any) {
    console.error('[parcel2go] return-label booking failed:', err)
    return res
      .status(500)
      .json({ error: err?.message ?? 'Failed to book return collection.' })
  }
}
