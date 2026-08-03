/**
 * Royal Mail Click & Drop API client.
 *
 * Docs: https://api.parcel.royalmail.com (Click & Drop Business API)
 * Auth: single Auth Key in the "Authorization" header (NOT OAuth/Bearer).
 *
 * Rate limits (per Royal Mail): ~2 requests/sec, max 2000 orders per
 * "create orders" call. We enforce a simple queue + backoff here so any
 * caller (this module, webhooks, admin actions) automatically respects it.
 */

const BASE_URL = 'https://api.parcel.royalmail.com/api/v1'

export type RoyalMailConfig = {
  apiKey: string
  tradingName?: string // set once client confirms which trading name to use
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  retries?: number
}

// --- very small in-process rate limiter: max ~2 req/sec ---
let lastRequestAt = 0
const MIN_INTERVAL_MS = 550 // slightly above 500ms to stay safely under 2/sec

async function throttle() {
  const now = Date.now()
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now)
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  lastRequestAt = Date.now()
}

export class RoyalMailClient {
  private apiKey: string
  private tradingName?: string

  constructor(config: RoyalMailConfig) {
    // Deliberately NOT throwing here even though apiKey is required for
    // real use. This provider is registered in medusa-config.ts, which
    // runs at server boot — throwing in the constructor would crash the
    // entire Medusa backend (not just Royal Mail shipping) any time the
    // key is unset. The check happens lazily in request() instead, so
    // only an actual shipping/label action fails, not the whole server.
    this.apiKey = config.apiKey ?? ''
    this.tradingName = config.tradingName
  }

  private async request<T>({
    method = 'GET',
    path,
    body,
    retries = 3,
  }: RequestOptions): Promise<T> {
    if (!this.apiKey) {
      throw new Error(
        '[royal-mail] Missing API key. Set ROYAL_MAIL_CLICK_DROP_API_KEY ' +
          'in the Medusa backend .env (server-side only, never NEXT_PUBLIC_) ' +
          'before Standard/Express shipping options can use this provider.',
      )
    }
    await throttle()

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    // Backoff on 429 / 5xx
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      const backoffMs = (4 - retries) * 1000 + 500
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      return this.request<T>({ method, path, body, retries: retries - 1 })
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // IMPORTANT: never log the API key or full raw body in production logs.
      throw new Error(
        `[royal-mail] Request failed: ${method} ${path} -> ${res.status} ${text.slice(
          0,
          300,
        )}`,
      )
    }

    // Some endpoints (e.g. cancel) return empty bodies
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
  }

  /**
   * Create a Click & Drop order (i.e. buy a shipping label) for a fulfillment.
   *
   * FIX (errorCode 84 — "Required property ... not found"): Click & Drop's
   * "create orders" schema requires order-value fields (subtotal,
   * shippingCostCharged, total, currencyCode) and a packageFormatIdentifier
   * per package — none of these were being sent before, so every order was
   * rejected at deserialization. All four are now required on the payload
   * type below so a caller can't accidentally omit them again.
   */
  async createOrder(order: RoyalMailCreateOrderPayload) {
    return this.request<RoyalMailCreateOrderResponse>({
      method: 'POST',
      path: '/orders',
      body: {
        items: [
          {
            ...order,
            ...(this.tradingName ? { tradingName: this.tradingName } : {}),
          },
        ],
      },
    })
  }

  async cancelOrder(royalMailOrderId: string) {
    return this.request<void>({
      method: 'POST',
      path: '/orders/cancel',
      body: { orderIdentifiers: [royalMailOrderId] },
    })
  }

  async getLabel(royalMailOrderId: string) {
    return this.request<{ url: string }>({
      method: 'GET',
      path: `/orders/${royalMailOrderId}/documents`,
    })
  }

  async getTracking(trackingNumber: string) {
    return this.request<RoyalMailTrackingResponse>({
      method: 'GET',
      path: `/tracking/${trackingNumber}`,
    })
  }
}

// --- Types ---

export type RoyalMailCreateOrderPayload = {
  orderReference: string // Medusa fulfillment/order id — used for idempotency
  recipient: {
    address: {
      fullName: string
      addressLine1: string
      addressLine2?: string
      addressLine3?: string
      city: string
      postcode: string
      countryCode: string
    }
    phoneNumber?: string
    emailAddress?: string
  }
  packages: Array<{
    weightInGrams: number
    // Required by Royal Mail's schema (confirmed via errorCode 84). This
    // store only ever ships physical goods (rackets, shoes, equipment) —
    // never letters/documents — so "parcel" is always correct here.
    packageFormatIdentifier: string
  }>
  // Real service code per shipping option, e.g. "TPN48" / "TPN24" for
  // Tracked 48 / Tracked 24 — confirm in Click & Drop dashboard > Manage
  // Services before hardcoding a different value anywhere.
  serviceCode: string
  orderDate: string // ISO date

  // Required by Royal Mail (errorCode 95/71/15) whenever no
  // AddressBookReference is used. IMPORTANT: this must be nested as
  // billing.address (mirroring recipient.address) — the error's field
  // paths ("Billing.Address.City", "Billing.Address.AddressLine1") confirm
  // Royal Mail does NOT accept a flat "billingAddress" key. This store
  // doesn't collect a separate billing address at checkout, so this is
  // populated from the same shipping address in service.ts.
  billing: {
    address: {
      fullName: string
      addressLine1: string
      addressLine2?: string
      addressLine3?: string
      city: string
      postcode: string
      countryCode: string
    }
  }

  // --- Order-value fields — required by Royal Mail (errorCode 84) for
  // customs/insurance valuation. All monetary amounts are in the same
  // currency, given by currencyCode. ---
  subtotal: number // value of goods, ex. shipping
  shippingCostCharged: number // what the customer paid for shipping
  total: number // subtotal + shippingCostCharged (+ tax, if included)
  currencyCode: string // e.g. "GBP"
}

export type RoyalMailCreateOrderResponse = {
  createdOrders: Array<{
    orderIdentifier: string
    trackingNumber: string
    orderReference: string
  }>
  failedOrders: Array<{
    orderReference: string
    // Click & Drop returns structured error objects here, not plain
    // strings — see service.ts's error handling for how these are
    // unpacked into a readable message.
    errors: Array<{ code?: string; message?: string } | string>
  }>
}

export type RoyalMailTrackingResponse = {
  trackingNumber: string
  status: string
  events: Array<{ eventCode: string; description: string; timestamp: string }>
}
