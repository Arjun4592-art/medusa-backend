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
import { RoyalMailClient, RoyalMailConfig } from './client'

type InjectedDependencies = {}

type RoyalMailProviderOptions = RoyalMailConfig

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

/**
 * Fulfillment Provider Module for Royal Mail Click & Drop.
 *
 * Registered in medusa-config.ts under modules -> Fulfillment Module ->
 * providers, id: "royal-mail". Only the two "Shipping" options (Standard,
 * Express) get linked to this provider in Admin — "Local Pickup" stays on
 * the built-in "Manual" provider, untouched.
 *
 * Each Shipping Option's `data` field must include:
 *   { service_code: "TOLP48" | "TOLP24" | ... }
 * (exact codes: PENDING client confirmation — see client.ts comment)
 */
class RoyalMailFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = 'royal-mail'

  protected client_: RoyalMailClient

  constructor(_: InjectedDependencies, options: RoyalMailProviderOptions) {
    super()
    this.client_ = new RoyalMailClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    const code48 = process.env.ROYAL_MAIL_SERVICE_CODE_48
    const code24 = process.env.ROYAL_MAIL_SERVICE_CODE_24
    if (!code48 || !code24) {
      console.warn(
        '[royal-mail] ROYAL_MAIL_SERVICE_CODE_48 and/or ROYAL_MAIL_SERVICE_CODE_24 are not set in .env — ' +
          "falling back to TOLP48/TOLP24. Set both env vars explicitly so this doesn't depend on a hardcoded default.",
      )
    }
    return [
      {
        id: 'royal-mail-tracked-48',
        name: 'Royal Mail Tracked 48',
        service_code: code48 || 'TOLP48',
      },
      {
        id: 'royal-mail-tracked-24',
        name: 'Royal Mail Tracked 24 (Express)',
        service_code: code24 || 'TOLP24',
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
        '[royal-mail] Shipping address must include postcode and country code.',
      )
    }
    return { ...data }
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return typeof data.service_code === 'string' && !!data.service_code
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
      '[royal-mail] calculatePrice not implemented — flat-rate mode is active.',
    )
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: FulfillmentItemDTO[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    if (fulfillment?.data && (fulfillment.data as any).royal_mail_order_id) {
      return { data: fulfillment.data as Record<string, unknown>, labels: [] }
    }

    const address = order?.shipping_address
    if (!address) {
      throw new Error('[royal-mail] Missing shipping address on order.')
    }

    const rawBilling = order?.billing_address as typeof address | undefined
    const billingHasData =
      !!rawBilling?.address_1 && !!rawBilling?.city && !!rawBilling?.postal_code
    const billingAddress = billingHasData ? rawBilling! : address

    const serviceCode =
      (data.service_code as string) ||
      process.env.ROYAL_MAIL_SERVICE_CODE_48 ||
      'TOLP48'

    const totalWeightGrams = items.reduce(
      (sum, item) => sum + estimateWeightGrams(item) * item.quantity,
      0,
    )

    const orderAny = order as any
    const currencyCode: string | undefined =
      orderAny?.currency_code ?? orderAny?.currencyCode
    const subtotal: number | undefined =
      orderAny?.item_subtotal ?? orderAny?.subtotal ?? orderAny?.item_total
    const shippingCostCharged: number | undefined =
      orderAny?.shipping_total ??
      orderAny?.shippingTotal ??
      orderAny?.shipping_methods?.[0]?.total ??
      orderAny?.shipping_methods?.[0]?.amount
    const total: number | undefined = orderAny?.total

    const missing: string[] = []
    if (!currencyCode) missing.push('currency_code')
    if (subtotal === undefined) missing.push('subtotal')
    if (shippingCostCharged === undefined) missing.push('shipping_total')
    if (total === undefined) missing.push('total')

    if (missing.length > 0) {
      throw new Error(
        `[royal-mail] Could not read required order-value field(s) from the ` +
          `order object passed to createFulfillment: ${missing.join(', ')}. ` +
          `Royal Mail requires subtotal/shippingCostCharged/total/currencyCode ` +
          `to create a label. Log the raw \`order\` argument here once to see ` +
          `its actual field names for this Medusa version, then update the ` +
          `mapping above instead of guessing further.`,
      )
    }

    const ROYAL_MAIL_MAX_CONSEQUENTIAL_LOSS = 10000
    const includedCompensation = Number(
      process.env.ROYAL_MAIL_INCLUDED_COMPENSATION_GBP ?? 75,
    )

    const response = await this.client_.createOrder({
      orderReference: String(
        fulfillment?.id ?? order?.id ?? crypto.randomUUID(),
      ),
      recipient: {
        address: {
          fullName:
            `${address.first_name ?? ''} ${address.last_name ?? ''}`.trim(),
          addressLine1: address.address_1 ?? '',
          addressLine2: address.address_2 ?? undefined,
          city: address.city ?? '',
          postcode: address.postal_code ?? '',
          countryCode: address.country_code?.toUpperCase() ?? 'GB',
        },
        phoneNumber: address.phone ?? undefined,
      },
      billing: {
        address: {
          fullName:
            `${billingAddress.first_name ?? ''} ${billingAddress.last_name ?? ''}`.trim() ||
            `${address.first_name ?? ''} ${address.last_name ?? ''}`.trim(),
          addressLine1: billingAddress.address_1 ?? '',
          addressLine2: billingAddress.address_2 ?? undefined,
          city: billingAddress.city ?? '',
          postcode: billingAddress.postal_code ?? '',
          countryCode: billingAddress.country_code?.toUpperCase() ?? 'GB',
        },
      },
      packages: [
        {
          weightInGrams: totalWeightGrams || DEFAULT_FALLBACK_WEIGHT_GRAMS,

          packageFormatIdentifier: 'parcel',
        },
      ],
      serviceCode,
      orderDate: new Date().toISOString(),
      subtotal: subtotal as number,
      shippingCostCharged: shippingCostCharged as number,
      total: total as number,
      currencyCode: (currencyCode as string).toUpperCase(),
      ...((subtotal as number) > includedCompensation
        ? {
            consequentialLoss: Math.min(
              Math.ceil(subtotal as number),
              ROYAL_MAIL_MAX_CONSEQUENTIAL_LOSS,
            ),
          }
        : {}),
    })

    const created = response.createdOrders?.[0]
    if (!created) {
      const failure = response.failedOrders?.[0]

      const errorDetail =
        failure?.errors
          ?.map((e: any) =>
            typeof e === 'string'
              ? e
              : (e?.message ?? e?.code ?? JSON.stringify(e)),
          )
          .join('; ') ?? (failure ? JSON.stringify(failure) : 'unknown error')
      throw new Error(`[royal-mail] Label purchase failed: ${errorDetail}`)
    }

    const trackingNumber = created.trackingNumber || undefined

    return {
      data: {
        royal_mail_order_id: created.orderIdentifier,
        ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
        service_code: serviceCode,
      },
      labels: trackingNumber
        ? [
            {
              tracking_number: trackingNumber,
              tracking_url: `https://www.royalmail.com/track-your-item#/tracking-results/${trackingNumber}`,
              label_url: '', // fetched lazily via getShipmentDocuments/getLabel
            },
          ]
        : [],
    }
  }

  async cancelFulfillment(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const royalMailOrderId = data?.royal_mail_order_id as string | undefined
    if (!royalMailOrderId) {
      // Nothing was ever bought (e.g. cancelled before fulfillment) — no-op
      return data
    }
    await this.client_.cancelOrder(royalMailOrderId)
    return { ...data, cancelled: true }
  }

  async getFulfillmentDocuments(
    data: Record<string, unknown>,
  ): Promise<never[]> {
    const royalMailOrderId = data?.royal_mail_order_id as string | undefined
    if (!royalMailOrderId) return [] as never[]
    const { url } = await this.client_.getLabel(royalMailOrderId)
    return [{ url, type: 'label' }] as never[]
  }

  async createReturnFulfillment(
    fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    const existing = (fulfillment?.data as any)?.royal_mail_return_id
    if (existing) {
      return { data: fulfillment.data as Record<string, unknown>, labels: [] }
    }

    const serviceCode = process.env.ROYAL_MAIL_RETURN_SERVICE_CODE
    if (!serviceCode) {
      throw new Error(
        '[royal-mail] ROYAL_MAIL_RETURN_SERVICE_CODE is not set. Call ' +
          'this.client_.getReturnServices() (or GET /returns/services ' +
          'directly) to see the return service codes available on this ' +
          'account — e.g. Tracked Returns 24 = "TSN", Tracked Returns 48 ' +
          '= "TSS" are the Royal Mail defaults, but confirm against your ' +
          'own account before hardcoding either.',
      )
    }

    const line1 = process.env.RETURN_ADDRESS_LINE1
    const city = process.env.RETURN_ADDRESS_CITY
    const postcode = process.env.RETURN_ADDRESS_POSTCODE
    const firstName = process.env.RETURN_ADDRESS_FIRST_NAME || 'Returns'
    const lastName = process.env.RETURN_ADDRESS_LAST_NAME || 'Department'
    const countryIsoCode = process.env.RETURN_ADDRESS_COUNTRY_ISO3 || 'GBR'
    const country = process.env.RETURN_ADDRESS_COUNTRY || 'United Kingdom'

    if (!line1 || !city || !postcode) {
      throw new Error(
        '[royal-mail] Missing RETURN_ADDRESS_LINE1 / RETURN_ADDRESS_CITY / ' +
          'RETURN_ADDRESS_POSTCODE env vars — set these to the address ' +
          'customers should post returns to before returns can be created.',
      )
    }

    const returnsAddress = {
      firstName,
      lastName,
      companyName: process.env.RETURN_ADDRESS_COMPANY || undefined,
      addressLine1: line1,
      addressLine2: process.env.RETURN_ADDRESS_LINE2 || undefined,
      city,
      county: process.env.RETURN_ADDRESS_COUNTY || undefined,
      postcode,
      country,
      countryIsoCode,
    }

    const response = await this.client_.createReturn({
      service: { serviceCode },
      shipment: {
        shippingAddress: returnsAddress,
        returnAddress: returnsAddress,
        customerReference: fulfillment?.id
          ? { reference: String(fulfillment.id) }
          : undefined,
      },
    })

    if (!response?.shipment?.trackingNumber) {
      throw new Error(
        '[royal-mail] Return label purchase did not return a tracking number.',
      )
    }

    return {
      data: {
        ...((fulfillment.data as object) ?? {}),
        royal_mail_return_id: response.shipment.uniqueItemId,
        return_tracking_number: response.shipment.trackingNumber,

        return_label_base64: response.label || undefined,
      },
      labels: [
        {
          tracking_number: response.shipment.trackingNumber,
          tracking_url: `https://www.royalmail.com/track-your-item#/tracking-results/${response.shipment.trackingNumber}`,
          label_url: '', // see getReturnDocuments — served as a data URI from cached base64
        },
      ],
    }
  }

  async getReturnDocuments(data: Record<string, unknown>): Promise<never[]> {
    const labelBase64 = data?.return_label_base64 as string | undefined
    if (!labelBase64) return [] as never[]
    return [
      { url: `data:application/pdf;base64,${labelBase64}`, type: 'label' },
    ] as never[]
  }

  async getShipmentDocuments(data: Record<string, unknown>): Promise<never[]> {
    return this.getFulfillmentDocuments(data)
  }
}

export default RoyalMailFulfillmentProviderService
