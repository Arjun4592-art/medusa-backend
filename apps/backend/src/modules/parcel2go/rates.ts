import type { Parcel2GoQuoteOption } from './client'
import type { TierId } from './shipping-tier'

/**
 * Customer-facing shipping price, worked out automatically from live
 * Parcel2Go quotes for ANY destination country.
 *
 * Env (all optional):
 *   SHIPPING_MARKUP_PERCENT   extra % on top of the courier cost   (default 0)
 *   SHIPPING_MARKUP_FLAT      extra £ on top of the courier cost   (default 0)
 *   CI_SHIPPING_SMALL         Jersey/Guernsey flat price, small    (default 9.99)
 *   CI_SHIPPING_LARGE         Jersey/Guernsey flat price, racket/bag (default 19.99)
 */
const CHANNEL_ISLANDS = ['JEY', 'GGY']

export function isChannelIslands(iso3?: string | null) {
  return CHANNEL_ISLANDS.includes((iso3 ?? '').toUpperCase())
}

function num(v: string | undefined, fallback: number) {
  const n = Number(v)
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback
}

/**
 * Couriers we never want to use. Matched (case-insensitive) against the
 * courier, service name and slug. Override with
 * PARCEL2GO_EXCLUDED_COURIERS="evri,yodel,hermes" (comma separated).
 */
export function isBlockedCourier(o: {
  courier?: string
  name?: string
  slug?: string
}): boolean {
  const list = (process.env.PARCEL2GO_EXCLUDED_COURIERS ?? 'evri,yodel,hermes')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  const hay = `${o.courier ?? ''} ${o.name ?? ''} ${o.slug ?? ''}`.toLowerCase()
  return list.some((b) => hay.includes(b))
}

export function isCollectionType(o: Parcel2GoQuoteOption): boolean {
  return /collection/i.test(
    String((o.raw as any)?.Service?.CollectionType ?? ''),
  )
}

/**
 * Picks the service to price and book.
 *  - "Collection" option  -> cheapest courier-collection service.
 *  - Standard option      -> cheapest service OVERALL (this is what keeps
 *    labels cheap: e.g. Guernsey's cheapest is Parcelforce, which is
 *    collection-only). Set PARCEL2GO_STRICT_PICKUP_TYPE=true to force
 *    drop-off-only services here instead (costs more on some routes).
 * If the wanted style isn't offered for a country, falls back to the
 * cheapest of any style so the customer always gets a price.
 */
export function cheapestQuote(
  options: Parcel2GoQuoteOption[],
  collection: boolean,
): Parcel2GoQuoteOption | undefined {
  const priced = options.filter((o) => o.price > 0 && !isBlockedCourier(o))
  const byPrice = (a: Parcel2GoQuoteOption, b: Parcel2GoQuoteOption) =>
    a.price - b.price
  const strict = /^(1|true|yes)$/i.test(
    process.env.PARCEL2GO_STRICT_PICKUP_TYPE ?? '',
  )
  const pool =
    collection || strict
      ? priced.filter((o) => isCollectionType(o) === collection)
      : priced
  return [...pool].sort(byPrice)[0] ?? [...priced].sort(byPrice)[0]
}

export function customerShippingPrice(args: {
  cost: number
  destinationIso3: string
  tierId: TierId
}): number {
  const pct = num(process.env.SHIPPING_MARKUP_PERCENT, 0)
  const flat = num(process.env.SHIPPING_MARKUP_FLAT, 0)
  const withMarkup = args.cost * (1 + pct / 100) + flat

  let price = withMarkup
  if (isChannelIslands(args.destinationIso3)) {
    const fixed =
      args.tierId === 'fedex'
        ? num(process.env.CI_SHIPPING_LARGE, 19.99)
        : num(process.env.CI_SHIPPING_SMALL, 9.99)
    // Never sell below what the courier actually charges us.
    price = Math.max(fixed, withMarkup)
  }
  return Math.ceil(price * 100 - 1e-9) / 100
}
