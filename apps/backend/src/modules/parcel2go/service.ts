import { AbstractFulfillmentProviderService } from '@medusajs/framework/utils'
import type {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceContext,
  CreateFulfillmentResult,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  ValidateFulfillmentDataContext,
} from '@medusajs/framework/types'
import {
  Parcel2GoClient,
  Parcel2GoConfig,
  Parcel2GoOrderAddress,
  Parcel2GoParcel,
  extractQuoteOptions,
  splitAddressLine,
  toIso3,
} from './client'

type InjectedDependencies = {}

type Parcel2GoProviderOptions = Parcel2GoConfig

const CATEGORY_WEIGHT_FALLBACKS: Array<{ pattern: RegExp; grams: number }> = [
  { pattern: /shoe|trainer|footwear/i, grams: 900 },
  { pattern: /racket|racquet/i, grams: 300 },
  { pattern: /squash/i, grams: 250 },
  { pattern: /string(ing)?/i, grams: 50 },
  { pattern: /bag|kit ?bag|backpack/i, grams: 700 },
  { pattern: /shuttlecock|shuttle/i, grams: 150 },
  { pattern: /clothing|shirt|short|jacket|top/i, grams: 200 },
]
const DEFAULT_FALLBACK_WEIGHT_GRAMS = 300

function estimateWeightGrams(item: FulfillmentItemDTO): number {
  const explicit =
    (item as any).weight ?? (item as any).variant?.weight ?? undefined
  if (typeof explicit === 'number' && explicit > 0) {
    return explicit
  }
  const title = String((item as any).title ?? '')
  const match = CATEGORY_WEIGHT_FALLBACKS.find((c) => c.pattern.test(title))
  return match?.grams ?? DEFAULT_FALLBACK_WEIGHT_GRAMS
}

function trackingUrl(trackingNumber: string) {
  // NEEDS-VERIFICATION: parcel2go.com/tracking accepts a tracking number
  // via its on-page search box (see https://parcel2go.com/tracking) — the
  // exact query-string param for deep-linking straight to results isn't
  // published, so confirm this against a real order before relying on it.
  return `https://www.parcel2go.com/tracking?trackingNumber=${encodeURIComponent(trackingNumber)}`
}

function buildParcel(weightKg: number, value = 50): Parcel2GoParcel {
  // Default box size — replace with real dimensions when products carry them.
  return { Value: value, Weight: weightKg, Length: 80, Width: 35, Height: 15 }
}

function toOrderAddress(a: {
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
}): Parcel2GoOrderAddress {
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

/**
 * Fulfillment Provider Module for Parcel2Go.
 *
 * Registered in medusa-config.ts under modules -> Fulfillment Module ->
 * providers, id: "parcel2go". Only the two "Shipping" options (Standard,
 * Express) get linked to this provider in Admin — "Local Pickup" stays on
 * the built-in "Manual" provider, untouched.
 *
 * Each Shipping Option's `data` field must include:
 *   { service_id: "<a Parcel2Go serviceId, e.g. from a getQuotes() call>" }
 * Unlike Royal Mail's fixed TOLP48/TOLP24 codes, Parcel2Go service ids are
 * returned per-quote from the live courier network, so createFulfillment()
 * re-quotes at fulfillment time and matches the configured id against
 * whatever the network currently offers for that courier/service pairing.
 */
class Parcel2GoFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = 'parcel2go'

  protected client_: Parcel2GoClient

  constructor(_: InjectedDependencies, options: Parcel2GoProviderOptions) {
    super()
    this.client_ = new Parcel2GoClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    const standard = process.env.PARCEL2GO_SERVICE_ID_STANDARD
    const express = process.env.PARCEL2GO_SERVICE_ID_EXPRESS
    if (!standard || !express) {
      console.warn(
        '[parcel2go] PARCEL2GO_SERVICE_ID_STANDARD and/or PARCEL2GO_SERVICE_ID_EXPRESS ' +
          'are not set in .env — run a getQuotes() call for your sender ' +
          'postcode to see the live serviceId values available on this ' +
          'account, then set both explicitly.',
      )
    }
    return [
      {
        id: 'parcel2go-standard',
        name: 'Parcel2Go Standard',
        service_id: standard || '',
      },
      {
        id: 'parcel2go-express',
        name: 'Parcel2Go Express',
        service_id: express || '',
      },
    ]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    const shippingAddress = context.shipping_address
    if (!shippingAddress?.postal_code || !shippingAddress?.country_code) {
      throw new Error(
        '[parcel2go] Shipping address must include postcode and country code.',
      )
    }
    // Carry the option's service_id (from getFulfillmentOptions) onto the
    // shipping method so createFulfillment() can read it later.
    return { ...optionData, ...data }
  }

  async validateOption(_data: Record<string, unknown>): Promise<boolean> {
    // service_id is resolved at fulfillment time (option data -> .env
    // fallback), so an option created without it is still valid.
    return true
  }

  async canCalculate(): Promise<boolean> {
    return false
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: CalculateShippingOptionPriceContext,
  ): Promise<CalculatedShippingOptionPrice> {
    throw new Error(
      '[parcel2go] calculatePrice not implemented — flat-rate mode is active.',
    )
  }

  private getSender() {
    const line1 = process.env.PARCEL2GO_SENDER_ADDRESS_LINE1
    const town = process.env.PARCEL2GO_SENDER_ADDRESS_TOWN
    const postcode = process.env.PARCEL2GO_SENDER_ADDRESS_POSTCODE
    if (!line1 || !town || !postcode) {
      throw new Error(
        '[parcel2go] Missing PARCEL2GO_SENDER_ADDRESS_LINE1 / _TOWN / _POSTCODE env vars.',
      )
    }
    return {
      name: process.env.PARCEL2GO_SENDER_NAME || 'Warehouse',
      company: this.client_.senderName,
      line1,
      line2: process.env.PARCEL2GO_SENDER_ADDRESS_LINE2,
      town,
      postcode,
      countryCode: process.env.PARCEL2GO_SENDER_ADDRESS_COUNTRY_ISO || 'GB',
      phone: process.env.PARCEL2GO_SENDER_PHONE,
      email: process.env.PARCEL2GO_SENDER_EMAIL,
    }
  }

  /**
   * Quote -> collection date -> create order -> pay with Prepay -> read
   * tracking number. Shared by outbound shipments and returns.
   */
  private async bookShipment(args: {
    serviceSlug: string
    collection: Parameters<typeof toOrderAddress>[0]
    delivery: Parameters<typeof toOrderAddress>[0]
    weightKg: number
    value: number
    contents: string
    customer: { email: string; forename: string; surname: string }
  }) {
    // Parcel2Go requires an email + phone on the collection address and an
    // email on the order. Fall back to the warehouse contact from .env.
    const senderEmail = process.env.PARCEL2GO_SENDER_EMAIL
    const senderPhone = process.env.PARCEL2GO_SENDER_PHONE
    const collectionAddr = toOrderAddress({
      ...args.collection,
      email: args.collection.email || senderEmail,
      phone: args.collection.phone || senderPhone,
    })
    const deliveryAddr = toOrderAddress({
      ...args.delivery,
      phone: args.delivery.phone || senderPhone,
    })
    // CustomerDetails = the account booking the label (the business), not the
    // end customer. The end customer's email only goes on the delivery address.
    const bookerEmail = senderEmail || args.customer.email || ''
    const [bookerForename, ...bookerRest] = (
      process.env.PARCEL2GO_SENDER_NAME || 'Warehouse Team'
    ).split(' ')
    const bookerSurname = bookerRest.join(' ') || 'Team'
    if (!collectionAddr.Email || !collectionAddr.Phone || !bookerEmail) {
      throw new Error(
        '[parcel2go] Missing contact details: set PARCEL2GO_SENDER_EMAIL and ' +
          'PARCEL2GO_SENDER_PHONE in the backend .env (Parcel2Go requires an ' +
          'email and phone on the collection address).',
      )
    }
    const parcel = buildParcel(args.weightKg, args.value)

    if (
      collectionAddr.Postcode.replace(/\s+/g, '').toUpperCase() ===
      deliveryAddr.Postcode.replace(/\s+/g, '').toUpperCase()
    ) {
      throw new Error(
        `[parcel2go] Collection postcode (${collectionAddr.Postcode}) and delivery ` +
          `postcode (${deliveryAddr.Postcode}) are the same — Parcel2Go rejects this. ` +
          `Check the order's shipping address, or PARCEL2GO_SENDER_ADDRESS_POSTCODE if this is test data.`,
      )
    }

    // 1. Quote — confirms the slug is still offered for this route.
    const quoteRes = await this.client_.getQuotes({
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
      Parcels: [parcel],
    })
    const options = extractQuoteOptions(quoteRes)
    // Never silently fall back to another courier: a wrong/unset slug used to
    // book whichever service happened to be first in the list (often a
    // £10+ Parcelforce one). Fail loudly instead.
    const matched = options.find((o) => o.slug === args.serviceSlug)
    if (!matched) {
      throw new Error(
        `[parcel2go] Service "${args.serviceSlug}" is not offered for ${deliveryAddr.Postcode} ` +
          `(${deliveryAddr.CountryIsoCode}). Check PARCEL2GO_SERVICE_ID_STANDARD / the shipping option's ` +
          `service_id, and that PARCEL2GO_ENVIRONMENT matches your credentials. ` +
          `Services offered right now: ${options.map((o) => o.slug).join(', ') || 'none'}.`,
      )
    }

    // 2. Collection date
    const dates = await this.client_.getCollectionDates({
      serviceSlug: matched.slug,
      address: `${collectionAddr.Property} ${collectionAddr.Street}`.trim(),
      city: collectionAddr.Town,
      postcode: collectionAddr.Postcode,
      countryIso3: collectionAddr.CountryIsoCode,
    })
    const collectionDate = dates.CollectionDates?.[0]?.CollectionDate
    if (!collectionDate) {
      throw new Error(
        `[parcel2go] No collection date available for service ${matched.slug}.`,
      )
    }

    // 2b. Make sure Prepay can actually cover this shipment BEFORE creating the
    // order. Parcel2Go answers an under-funded paywithprepay with a bare
    // 500 "An error has occurred.", and leaves an unpaid order behind.
    const prepayBalance = await this.client_
      .getPrepayBalance()
      .catch(() => null)
    if (prepayBalance !== null && prepayBalance < matched.price) {
      throw new Error(
        `[parcel2go] Prepay balance (£${prepayBalance.toFixed(2)}) is lower than the cost of this ` +
          `shipment (£${matched.price.toFixed(2)}). Top up Prepay in your Parcel2Go account and try again.`,
      )
    }

    // 3. Create order
    const created = await this.client_.createOrder({
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
              Height: parcel.Height,
              Length: parcel.Length,
              Width: parcel.Width,
              Weight: parcel.Weight,
              EstimatedValue: parcel.Value,
              // the delivery address goes INSIDE the parcel in POST /orders
              DeliveryAddress: deliveryAddr,
              ContentsSummary: args.contents,
            },
          ],
          CollectionAddress: collectionAddr,
        },
      ],
      CustomerDetails: {
        Email: bookerEmail,
        Forename: bookerForename,
        Surname: bookerSurname,
      },
    })
    const orderId = String(created.OrderId)

    // 4. Pay from Prepay balance (no browser redirect needed)
    await this.client_.payOrderWithPrepay(orderId)

    // 5. Tracking number (may be empty until the courier assigns it)
    const parcels = await this.client_
      .getParcelNumbers(orderId)
      .catch(() => ({ TrackingNumbers: [] }))
    const trackingNumber =
      parcels.TrackingNumbers?.find((t) => !!t.TrackingNumber)
        ?.TrackingNumber ?? undefined

    return { orderId, slug: matched.slug, trackingNumber }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: FulfillmentItemDTO[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    if (fulfillment?.data && (fulfillment.data as any).parcel2go_order_id) {
      return { data: fulfillment.data as Record<string, unknown>, labels: [] }
    }

    const address = order?.shipping_address
    if (!address) {
      throw new Error('[parcel2go] Missing shipping address on order.')
    }
    // .env is the source of truth. The option's stored `service_id` is only a
    // snapshot taken when the option was created in Medusa Admin (and copied
    // onto every shipping method), so it goes stale — e.g. it kept booking
    // "Yodel 48" after .env was changed to another service. Use it only as a
    // fallback when .env has no slug.
    const envSlug =
      data.id === 'parcel2go-express'
        ? process.env.PARCEL2GO_SERVICE_ID_EXPRESS
        : process.env.PARCEL2GO_SERVICE_ID_STANDARD
    const configuredSlug = envSlug || (data.service_id as string) || ''
    if (!configuredSlug) {
      throw new Error(
        '[parcel2go] Shipping option has no service_id configured.',
      )
    }

    const totalWeightGrams = items.reduce(
      (sum, item) => sum + estimateWeightGrams(item) * item.quantity,
      0,
    )
    const weightKg = (totalWeightGrams || DEFAULT_FALLBACK_WEIGHT_GRAMS) / 1000

    const orderAny = order as any
    const total = Number(orderAny?.total ?? 50) || 50
    const first = address.first_name ?? ''
    const last = address.last_name ?? ''

    const result = await this.bookShipment({
      serviceSlug: configuredSlug,
      collection: this.getSender(),
      delivery: {
        name: `${first} ${last}`.trim(),
        line1: address.address_1 ?? '',
        line2: address.address_2,
        town: address.city ?? '',
        county: address.province,
        postcode: address.postal_code ?? '',
        countryCode: address.country_code,
        phone: address.phone,
        email: orderAny?.email,
      },
      weightKg,
      value: total,
      contents: 'Sports goods',
      customer: {
        email: orderAny?.email || process.env.PARCEL2GO_SENDER_EMAIL || '',
        forename: first || 'Customer',
        surname: last || '-',
      },
    })

    return {
      data: {
        parcel2go_order_id: result.orderId,
        ...(result.trackingNumber
          ? { tracking_number: result.trackingNumber }
          : {}),
        service_id: result.slug,
        // cached so createReturnFulfillment() can use it later
        customer_address: {
          name: `${first} ${last}`.trim(),
          line1: address.address_1 ?? '',
          line2: address.address_2 ?? undefined,
          town: address.city ?? '',
          postcode: address.postal_code ?? '',
          countryCode: address.country_code ?? 'GB',
          phone: address.phone ?? undefined,
        },
      },
      labels: result.trackingNumber
        ? [
            {
              tracking_number: result.trackingNumber,
              tracking_url: trackingUrl(result.trackingNumber),
              label_url: '', // served by GET /admin/orders/:id/shipping-label
            },
          ]
        : [],
    }
  }

  async cancelFulfillment(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // The Parcel2Go public API (Swagger v1) has no cancel endpoint, so the
    // booking must be cancelled from the Parcel2Go dashboard. We only mark
    // it locally so Medusa can proceed.
    const id = data?.parcel2go_order_id as string | undefined
    if (id) {
      console.warn(
        `[parcel2go] Order ${id} must be cancelled manually in the Parcel2Go dashboard (no API endpoint).`,
      )
    }
    return { ...data, cancelled: true }
  }

  async getFulfillmentDocuments(
    data: Record<string, unknown>,
  ): Promise<never[]> {
    // Parcel2Go returns labels as base64, not a hosted URL. The dashboard
    // uses GET /admin/orders/:id/shipping-label instead, so nothing here.
    return [] as never[]
  }

  async createReturnFulfillment(
    fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    const existing = (fulfillment?.data as any)?.parcel2go_return_order_id
    if (existing) {
      return { data: fulfillment.data as Record<string, unknown>, labels: [] }
    }

    const serviceSlug = process.env.PARCEL2GO_RETURN_SERVICE_ID
    if (!serviceSlug) {
      throw new Error(
        '[parcel2go] PARCEL2GO_RETURN_SERVICE_ID (a service slug) is not set.',
      )
    }
    const line1 = process.env.RETURN_ADDRESS_LINE1
    const town = process.env.RETURN_ADDRESS_CITY
    const postcode = process.env.RETURN_ADDRESS_POSTCODE
    if (!line1 || !town || !postcode) {
      throw new Error(
        '[parcel2go] Missing RETURN_ADDRESS_LINE1 / _CITY / _POSTCODE env vars.',
      )
    }
    const customer = (fulfillment?.data as any)?.customer_address
    if (!customer) {
      throw new Error(
        '[parcel2go] No customer address cached on this fulfillment — cannot book a return collection.',
      )
    }

    const result = await this.bookShipment({
      serviceSlug,
      collection: customer,
      delivery: {
        name: `${process.env.RETURN_ADDRESS_FIRST_NAME || 'Returns'} ${process.env.RETURN_ADDRESS_LAST_NAME || 'Department'}`.trim(),
        company: process.env.RETURN_ADDRESS_COMPANY,
        line1,
        line2: process.env.RETURN_ADDRESS_LINE2,
        town,
        postcode,
        countryCode: process.env.RETURN_ADDRESS_COUNTRY_ISO || 'GB',
      },
      weightKg: 0.5,
      value: 50,
      contents: 'Returned sports goods',
      customer: {
        email: process.env.PARCEL2GO_SENDER_EMAIL || '',
        forename: 'Returns',
        surname: 'Customer',
      },
    })

    if (!result.trackingNumber) {
      throw new Error(
        '[parcel2go] Return booked but no tracking number returned yet.',
      )
    }

    return {
      data: {
        ...((fulfillment.data as object) ?? {}),
        parcel2go_return_order_id: result.orderId,
        return_tracking_number: result.trackingNumber,
      },
      labels: [
        {
          tracking_number: result.trackingNumber,
          tracking_url: trackingUrl(result.trackingNumber),
          label_url: '',
        },
      ],
    }
  }

  async getReturnDocuments(data: Record<string, unknown>): Promise<never[]> {
    const labelUrl = data?.return_label_url as string | undefined
    if (!labelUrl) return [] as never[]
    return [{ url: labelUrl, type: 'label' }] as never[]
  }

  async getShipmentDocuments(data: Record<string, unknown>): Promise<never[]> {
    return this.getFulfillmentDocuments(data)
  }
}

export default Parcel2GoFulfillmentProviderService
