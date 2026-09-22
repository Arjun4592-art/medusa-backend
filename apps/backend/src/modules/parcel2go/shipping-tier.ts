/**
 * Picks the cheapest FedEx / Royal Mail DROP-OFF service that physically fits
 * an order. Slugs and prices come from live Parcel2Go quotes
 * (M15 5JP -> EC1A 1BB, inc VAT), so re-run scripts/get-parcel2go-quotes.ts
 * if Parcel2Go changes a slug.
 *
 *   Large Letter  <=1kg, 35x25x2cm   RM 48: £2.85  | RM 24: £3.80
 *   Small Parcel  <=2kg, 45x35x16cm  RM 48: £3.65  | RM 24: £4.65
 *   FedEx         everything else    Economy: £5.89 | Priority: £6.02
 *
 * Unknown / unrecognised items always fall through to FedEx (safe default).
 */

export type TierId = 'large-letter' | 'small-parcel' | 'fedex'

export type ShippingTier = {
  id: TierId
  /** "Standard" shipping option (cheaper, 48h) */
  standardSlug: string
  /** "Express" shipping option (24h) */
  expressSlug: string
  parcel: { Length: number; Width: number; Height: number }
  maxWeightKg: number
}

const FEDEX_STANDARD = 'fedex-uk-express-dropoff_895'
const FEDEX_EXPRESS = 'fedex-uk-express-dropoff'

export const TIERS: Record<TierId, ShippingTier> = {
  'large-letter': {
    id: 'large-letter',
    standardSlug: 'royalmail-largeletter-48',
    expressSlug: 'royalmail-largeletter-24',
    parcel: { Length: 35, Width: 25, Height: 2 },
    maxWeightKg: 1,
  },
  'small-parcel': {
    id: 'small-parcel',
    standardSlug: 'royalmail-int_2606',
    expressSlug: 'royalmail-int_2606_2607',
    parcel: { Length: 45, Width: 35, Height: 16 },
    maxWeightKg: 2,
  },
  fedex: {
    id: 'fedex',
    standardSlug: FEDEX_STANDARD,
    expressSlug: FEDEX_EXPRESS,
    parcel: { Length: 80, Width: 35, Height: 15 },
    maxWeightKg: 30,
  },
}

/**
 * Same tiers, but COLLECTION slugs — the courier picks up from an address
 * instead of it being dropped off at a shop/locker. Used two ways:
 *  - Outbound "Collection" shipping option: courier picks up from the
 *    warehouse, delivers to the customer.
 *  - NOT used for customer returns — those are drop-off only (see TIERS),
 *    the customer takes the parcel to a shop themselves.
 * Prices (inc VAT, M15 5JP -> EC1A 1BB): Large Letter / Small Parcel both
 * use Royal Mail 48 Tracked Small Collection (£3.95); FedEx Economy
 * Collection is £9.38.
 */
export const COLLECTION_TIERS: Record<TierId, ShippingTier> = {
  'large-letter': {
    ...TIERS['large-letter'],
    standardSlug: 'royalmail-int_2606_2608',
    expressSlug: 'royalmail-int_2606_2608_2609',
  },
  'small-parcel': {
    ...TIERS['small-parcel'],
    standardSlug: 'royalmail-int_2606_2608',
    expressSlug: 'royalmail-int_2606_2608_2609',
  },
  fedex: {
    ...TIERS.fedex,
    standardSlug: 'fedex-uk-economy-1',
    expressSlug: 'fedex-uk-express',
  },
}

/** What to try if the chosen tier's slug isn't offered for this address. */
export function fallbackSlug(express: boolean): string {
  return express ? FEDEX_EXPRESS : FEDEX_STANDARD
}

/** Collection equivalent of fallbackSlug(), for the outbound Collection option. */
export function collectionFallbackSlug(express: boolean): string {
  return express ? 'fedex-uk-express' : 'fedex-uk-economy-1'
}

// Old names kept as aliases — customer returns now use drop-off (TIERS),
// but these still work for anything importing the previous names.
export const RETURN_TIERS = COLLECTION_TIERS
export const returnFallbackSlug = collectionFallbackSlug

type ItemProfile = { flat: boolean; thicknessCm: number }

// Anything long, bulky or sold in big multipacks -> FedEx.
const ALWAYS_FEDEX =
  /racket|racquet|bag|backpack|holdall|reel|200 ?m\b|dozen|\bx ?(30|24|50|12)\b|\b(30|24|50|12) ?-?pack/i
const MULTI_PACK_OF_3 = /\b3 ?-?(pack|pair)s?\b|pack of 3|\bx ?3\b/i

/**
 * Returns null when the item can't go in a small box (=> FedEx).
 *
 * `productType` is the Medusa "Type" field on the product. If it is exactly
 * Flat / Small / Large it overrides the title-keyword guess below.
 */
export function profileItem(
  title: string,
  productType?: string | null,
): ItemProfile | null {
  const type = (productType ?? '').trim()
  if (/^flat$/i.test(type)) return { flat: true, thicknessCm: 1 }
  if (/^small$/i.test(type)) return { flat: false, thicknessCm: 8 }
  if (/^(large|fedex)$/i.test(type)) return null

  const t = title || ''
  if (ALWAYS_FEDEX.test(t)) return null
  if (/shoe|trainer|footwear/i.test(t)) return { flat: false, thicknessCm: 13 }
  if (
    /grip|damp|headband|wristband|sock|keychain|protection tape|\b1[02] ?m\b|hybrid set/i.test(
      t,
    )
  ) {
    return { flat: true, thicknessCm: MULTI_PACK_OF_3.test(t) ? 2 : 1 }
  }
  if (/shuttle|ball|\btin\b|\btube\b|\bcan\b/i.test(t)) {
    return { flat: false, thicknessCm: 8 }
  }
  if (
    /shirt|short|jacket|top\b|dress|skirt|hoodie|\btee\b|polo|trouser|\bhat\b|\bcap\b/i.test(
      t,
    )
  ) {
    return { flat: false, thicknessCm: 4 }
  }
  return null
}

/** Medusa can hand quantity over as a number, string or BigNumber object. */
export function toQty(q: unknown): number {
  const n = Number((q as any)?.numeric ?? q)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function pickTier(
  items: { title: string; quantity: unknown; productType?: string | null }[],
  weightKg: number,
): ShippingTier {
  if (!items.length) return TIERS.fedex

  let thickness = 0
  let allFlat = true
  for (const it of items) {
    const p = profileItem(it.title, it.productType)
    if (!p) return TIERS.fedex
    thickness += p.thicknessCm * toQty(it.quantity)
    if (!p.flat) allFlat = false
  }

  if (allFlat && thickness <= 2 && weightKg <= 1) return TIERS['large-letter']
  if (thickness <= 16 && weightKg <= 2) return TIERS['small-parcel']
  return TIERS.fedex
}
