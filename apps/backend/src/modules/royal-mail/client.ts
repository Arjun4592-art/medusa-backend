const BASE_URL = 'https://api.parcel.royalmail.com/api/v1'

export type RoyalMailConfig = {
  apiKey: string
  tradingName?: string
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  retries?: number
}

let lastRequestAt = 0
const MIN_INTERVAL_MS = 550

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

  async getReturnServices() {
    return this.request<RoyalMailGetReturnServicesResponse>({
      method: 'GET',
      path: '/returns/services',
    })
  }

  async createReturn(payload: RoyalMailCreateReturnPayload) {
    return this.request<RoyalMailCreateReturnResponse>({
      method: 'POST',
      path: '/returns',
      body: payload,
    })
  }
}

export type RoyalMailCreateOrderPayload = {
  orderReference: string
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

    packageFormatIdentifier: string
  }>

  serviceCode: string
  orderDate: string

  consequentialLoss?: number

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

  subtotal: number
  shippingCostCharged: number
  total: number
  currencyCode: string
}

export type RoyalMailCreateOrderResponse = {
  createdOrders: Array<{
    orderIdentifier: string
    trackingNumber: string
    orderReference: string
  }>
  failedOrders: Array<{
    orderReference: string

    errors: Array<{ code?: string; message?: string } | string>
  }>
}

export type RoyalMailTrackingResponse = {
  trackingNumber: string
  status: string
  events: Array<{ eventCode: string; description: string; timestamp: string }>
}

export type RoyalMailReturnAddress = {
  firstName: string
  lastName: string
  companyName?: string
  addressLine1: string
  addressLine2?: string
  addressLine3?: string
  city: string
  county?: string
  postcode: string
  country: string

  countryIsoCode: string
}

export type RoyalMailGetReturnServicesResponse = {
  services: Array<{
    carrierGuid: string
    carrierServiceGuid: string
    serviceName: string
    serviceCode: string
  }>
}

export type RoyalMailCreateReturnPayload = {
  service: {
    serviceCode: string
    serviceRegisterCode?: string
  }
  shipment: {
    shippingAddress: RoyalMailReturnAddress

    returnAddress: RoyalMailReturnAddress
    customerReference?: { reference: string }
  }
}

export type RoyalMailCreateReturnResponse = {
  shipment: {
    trackingNumber: string
    uniqueItemId: string
  }
  qrCode: string
  label: string
}
