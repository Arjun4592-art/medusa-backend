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

type InjectedDependencies = {
  // add logger/eventBus etc. here if/when needed
}

type RoyalMailProviderOptions = RoyalMailConfig

// --- Category-based fallback weights (grams) ---------------------------
// Used ONLY when Medusa doesn't give us a real per-item weight (i.e.
// item.weight / item.variant?.weight are both missing). A single flat
// 200g fallback for every product was wrong for this store: rackets,
// squash gear, and shoes are all very different weights, and an
// under-declared weight risks Royal Mail rejecting the parcel or billing
// a "weight discrepancy" surcharge later. Matched against the item title
// as a best-effort guess — set real weights on product variants in
// Medusa to avoid relying on this entirely.
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
 *   { service_code: "TPN48" | "TPN24" | ... }
 * (exact codes: PENDING client confirmation — see client.ts comment)
 */
class RoyalMailFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = 'royal-mail'

  protected client_: RoyalMailClient

  constructor(_: InjectedDependencies, options: RoyalMailProviderOptions) {
    super()
    this.client_ = new RoyalMailClient(options)
  }

  /**
   * The two fulfillment options exposed to Standard/Express shipping
   * options. `service_code` here is a *default* — a shipping option can
   * override it via its own `data.service_code`.
   */
  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: 'royal-mail-tracked-48',
        name: 'Royal Mail Tracked 48',
        // PENDING: confirm real service code before go-live
        service_code: 'TPN48',
      },
      {
        id: 'royal-mail-tracked-24',
        name: 'Royal Mail Tracked 24 (Express)',
        // PENDING: confirm real service code before go-live
        service_code: 'TPN24',
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
    // Flip to true once "live rate at checkout" is decided (currently
    // pending client input — flat rate vs live Click & Drop rate).
    return false
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: CalculateShippingOptionPriceContext,
  ): Promise<CalculatedShippingOptionPrice> {
    // Only relevant once canCalculate() returns true (live-rate mode).
    // Until then, Standard/Express use a flat rate configured directly on
    // the Shipping Option in Medusa Admin, and this is never called.
    throw new Error(
      '[royal-mail] calculatePrice not implemented — flat-rate mode is active.',
    )
  }

  /**
   * Buys the actual label via Click & Drop. `data.id` on the returned
   * result becomes the fulfillment's provider-side id (stored on the
   * Medusa Fulfillment record) — used later for cancel/tracking lookups.
   *
   * Idempotency: we pass the Medusa fulfillment id as `orderReference` to
   * Royal Mail. If a webhook or retry calls this twice for the same
   * fulfillment, check `data.royal_mail_order_id` first (set after the
   * first successful call) and short-circuit instead of buying a second
   * label. Wire that check up wherever this is invoked from Medusa's
   * fulfillment workflow, since Medusa itself won't dedupe for you.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    items: FulfillmentItemDTO[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    if (fulfillment?.data && (fulfillment.data as any).royal_mail_order_id) {
      // Already created — return existing data untouched (idempotency guard)
      return { data: fulfillment.data as Record<string, unknown>, labels: [] }
    }

    const address = order?.shipping_address
    if (!address) {
      throw new Error('[royal-mail] Missing shipping address on order.')
    }
    // No separate billing address is collected at this store's checkout —
    // reuse the shipping address if billing_address is missing OR present
    // but empty. `?? address` alone wasn't enough: Medusa can return
    // billing_address as a defined-but-empty object (e.g. POS/guest
    // orders) rather than null/undefined, so `??` never falls back and
    // Royal Mail got empty strings for every billing field. Checking that
    // the required fields are actually populated catches that case too.
    const rawBilling = order?.billing_address as typeof address | undefined
    const billingHasData =
      !!rawBilling?.address_1 && !!rawBilling?.city && !!rawBilling?.postal_code
    const billingAddress = billingHasData ? rawBilling! : address

    const serviceCode = (data.service_code as string) || 'TPN48'

    // Weight: per-item, category-aware fallback — see estimateWeightGrams
    // above. A flat 200g default was wrong for this store (rackets, shoes,
    // squash gear are very different weights).
    const totalWeightGrams = items.reduce(
      (sum, item) => sum + estimateWeightGrams(item) * item.quantity,
      0,
    )

    // --- Order-value fields Royal Mail requires (errorCode 84) ---
    //
    // These aren't on FulfillmentItemDTO — they have to come off the
    // order. Medusa's FulfillmentOrderDTO shape can vary slightly by
    // version, so this tries the common field names in order and fails
    // loudly (rather than silently sending 0/wrong values) if none are
    // present, so a real mismatch surfaces immediately instead of quietly
    // under-declaring parcel value to Royal Mail.
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
          // This store only ships physical goods — always a parcel.
          packageFormatIdentifier: 'parcel',
        },
      ],
      serviceCode,
      orderDate: new Date().toISOString(),
      subtotal: subtotal as number,
      shippingCostCharged: shippingCostCharged as number,
      total: total as number,
      currencyCode: (currencyCode as string).toUpperCase(),
    })

    const created = response.createdOrders?.[0]
    if (!created) {
      const failure = response.failedOrders?.[0]
      // Click & Drop returns `errors` as an array of objects (e.g.
      // { code, message }), not strings — .join(', ') on objects
      // stringified to "[object Object]" and hid the real reason before.
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

    // NOTE: Royal Mail's createOrders endpoint frequently does NOT return a
    // tracking number until a label is actually generated (confirmed
    // Click & Drop platform behaviour, not a bug in this integration —
    // see their own community forum: "Tracking number is not returned in
    // the response, even when the order is successfully sent... due to
    // labels not being generated"). Medusa's FulfillmentLabel.tracking_number
    // is NOT NULL, so building a label with `undefined` crashed the whole
    // fulfillment-create DB transaction even though Royal Mail had already
    // accepted the order. Only attach a label when we actually have a
    // tracking number; otherwise still return success (order IS placed —
    // royal_mail_order_id is saved either way) with no labels yet. Once
    // getFulfillmentDocuments/getShipmentDocuments below is called (e.g.
    // when staff go to print the label), that generates/fetches the real
    // label + tracking number from Click & Drop.
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

  /**
   * Returns: whether this also issues a Royal Mail *return* label is
   * PENDING client confirmation (self-ship vs prepaid-label return).
   * Left unimplemented on purpose — wire this up once decided so we don't
   * build the wrong flow.
   */
  async createReturnFulfillment(
    fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    throw new Error(
      '[royal-mail] Return fulfillment not implemented yet — pending ' +
        'client decision on prepaid-label vs self-ship returns.',
    )
  }

  async getShipmentDocuments(data: Record<string, unknown>): Promise<never[]> {
    return this.getFulfillmentDocuments(data)
  }
}

export default RoyalMailFulfillmentProviderService
