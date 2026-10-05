/**
 * Parcel2Go REST API client (v1, base path /api).
 *
 * Source of truth: sandbox Swagger (https://sandbox.parcel2go.com/api/swagger).
 * The API uses PascalCase JSON keys (CollectionAddress, Parcels, OrderId ...).
 *
 * Flow: /quotes -> /collectiondates -> POST /orders -> POST
 * /orders/{id}/paywithprepay -> GET /labels/{id} + POST
 * /orders/{id}/parcelnumbers.
 *
 * Fields marked VERIFY are only partly visible in the Swagger examples
 * (the example boxes are truncated). If the API replies 400 "The request is
 * invalid.", check those first — err.parcel2goError holds the raw body.
 */

export type Parcel2GoConfig = {
  clientId: string
  clientSecret: string
  /** 'live' -> www.parcel2go.com, 'sandbox' -> sandbox.parcel2go.com */
  environment?: 'live' | 'sandbox'
  senderName?: string
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  retries?: number
}

let lastRequestAt = 0
const MIN_INTERVAL_MS = 350

async function throttle() {
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now())
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parcel2Go wants Property (house no./name) and Street separately, while
 * Medusa / .env give a single "address line 1".
 *   "12 High Street"  -> { property: "12", street: "High Street" }
 *   "Flat 3, Oak Ct"  -> { property: "Flat 3", street: "Oak Ct" }
 * If line 2 is supplied and line 1 has no obvious number, line 1 becomes the
 * property and line 2 the street.
 */
export function splitAddressLine(
  line1: string,
  line2?: string,
): { property: string; street: string } {
  const l1 = (line1 ?? '').trim()
  const l2 = (line2 ?? '').trim()

  if (l1.includes(',')) {
    const [first, ...rest] = l1.split(',')
    return {
      property: first.trim(),
      street: [rest.join(',').trim(), l2].filter(Boolean).join(', '),
    }
  }

  const m = l1.match(/^(\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?)\s+(.+)$/)
  if (m) {
    return {
      property: m[1],
      street: [m[2], l2].filter(Boolean).join(', '),
    }
  }

  if (l2) return { property: l1, street: l2 }
  return { property: l1, street: l1 }
}

/** All ISO 3166-1 alpha-2 -> alpha-3 codes, so every country on the site works. */
export const ISO2_TO_ISO3: Record<string, string> = {
  AD: 'AND',
  AE: 'ARE',
  AF: 'AFG',
  AG: 'ATG',
  AI: 'AIA',
  AL: 'ALB',
  AM: 'ARM',
  AO: 'AGO',
  AQ: 'ATA',
  AR: 'ARG',
  AS: 'ASM',
  AT: 'AUT',
  AU: 'AUS',
  AW: 'ABW',
  AX: 'ALA',
  AZ: 'AZE',
  BA: 'BIH',
  BB: 'BRB',
  BD: 'BGD',
  BE: 'BEL',
  BF: 'BFA',
  BG: 'BGR',
  BH: 'BHR',
  BI: 'BDI',
  BJ: 'BEN',
  BL: 'BLM',
  BM: 'BMU',
  BN: 'BRN',
  BO: 'BOL',
  BQ: 'BES',
  BR: 'BRA',
  BS: 'BHS',
  BT: 'BTN',
  BV: 'BVT',
  BW: 'BWA',
  BY: 'BLR',
  BZ: 'BLZ',
  CA: 'CAN',
  CC: 'CCK',
  CD: 'COD',
  CF: 'CAF',
  CG: 'COG',
  CH: 'CHE',
  CI: 'CIV',
  CK: 'COK',
  CL: 'CHL',
  CM: 'CMR',
  CN: 'CHN',
  CO: 'COL',
  CR: 'CRI',
  CU: 'CUB',
  CV: 'CPV',
  CW: 'CUW',
  CX: 'CXR',
  CY: 'CYP',
  CZ: 'CZE',
  DE: 'DEU',
  DJ: 'DJI',
  DK: 'DNK',
  DM: 'DMA',
  DO: 'DOM',
  DZ: 'DZA',
  EC: 'ECU',
  EE: 'EST',
  EG: 'EGY',
  EH: 'ESH',
  ER: 'ERI',
  ES: 'ESP',
  ET: 'ETH',
  FI: 'FIN',
  FJ: 'FJI',
  FK: 'FLK',
  FM: 'FSM',
  FO: 'FRO',
  FR: 'FRA',
  GA: 'GAB',
  GB: 'GBR',
  GD: 'GRD',
  GE: 'GEO',
  GF: 'GUF',
  GG: 'GGY',
  GH: 'GHA',
  GI: 'GIB',
  GL: 'GRL',
  GM: 'GMB',
  GN: 'GIN',
  GP: 'GLP',
  GQ: 'GNQ',
  GR: 'GRC',
  GS: 'SGS',
  GT: 'GTM',
  GU: 'GUM',
  GW: 'GNB',
  GY: 'GUY',
  HK: 'HKG',
  HM: 'HMD',
  HN: 'HND',
  HR: 'HRV',
  HT: 'HTI',
  HU: 'HUN',
  ID: 'IDN',
  IE: 'IRL',
  IL: 'ISR',
  // Parcel2Go rejects IMN ("Invalid delivery country"); the Isle of Man is
  // quoted as GBR with an IM postcode.
  IM: 'GBR',
  IN: 'IND',
  IO: 'IOT',
  IQ: 'IRQ',
  IR: 'IRN',
  IS: 'ISL',
  IT: 'ITA',
  JE: 'JEY',
  JM: 'JAM',
  JO: 'JOR',
  JP: 'JPN',
  KE: 'KEN',
  KG: 'KGZ',
  KH: 'KHM',
  KI: 'KIR',
  KM: 'COM',
  KN: 'KNA',
  KP: 'PRK',
  KR: 'KOR',
  KW: 'KWT',
  KY: 'CYM',
  KZ: 'KAZ',
  LA: 'LAO',
  LB: 'LBN',
  LC: 'LCA',
  LI: 'LIE',
  LK: 'LKA',
  LR: 'LBR',
  LS: 'LSO',
  LT: 'LTU',
  LU: 'LUX',
  LV: 'LVA',
  LY: 'LBY',
  MA: 'MAR',
  MC: 'MCO',
  MD: 'MDA',
  ME: 'MNE',
  MF: 'MAF',
  MG: 'MDG',
  MH: 'MHL',
  MK: 'MKD',
  ML: 'MLI',
  MM: 'MMR',
  MN: 'MNG',
  MO: 'MAC',
  MP: 'MNP',
  MQ: 'MTQ',
  MR: 'MRT',
  MS: 'MSR',
  MT: 'MLT',
  MU: 'MUS',
  MV: 'MDV',
  MW: 'MWI',
  MX: 'MEX',
  MY: 'MYS',
  MZ: 'MOZ',
  NA: 'NAM',
  NC: 'NCL',
  NE: 'NER',
  NF: 'NFK',
  NG: 'NGA',
  NI: 'NIC',
  NL: 'NLD',
  NO: 'NOR',
  NP: 'NPL',
  NR: 'NRU',
  NU: 'NIU',
  NZ: 'NZL',
  OM: 'OMN',
  PA: 'PAN',
  PE: 'PER',
  PF: 'PYF',
  PG: 'PNG',
  PH: 'PHL',
  PK: 'PAK',
  PL: 'POL',
  PM: 'SPM',
  PN: 'PCN',
  PR: 'PRI',
  PS: 'PSE',
  PT: 'PRT',
  PW: 'PLW',
  PY: 'PRY',
  QA: 'QAT',
  RE: 'REU',
  RO: 'ROU',
  RS: 'SRB',
  RU: 'RUS',
  RW: 'RWA',
  SA: 'SAU',
  SB: 'SLB',
  SC: 'SYC',
  SD: 'SDN',
  SE: 'SWE',
  SG: 'SGP',
  SH: 'SHN',
  SI: 'SVN',
  SJ: 'SJM',
  SK: 'SVK',
  SL: 'SLE',
  SM: 'SMR',
  SN: 'SEN',
  SO: 'SOM',
  SR: 'SUR',
  SS: 'SSD',
  ST: 'STP',
  SV: 'SLV',
  SX: 'SXM',
  SY: 'SYR',
  SZ: 'SWZ',
  TC: 'TCA',
  TD: 'TCD',
  TF: 'ATF',
  TG: 'TGO',
  TH: 'THA',
  TJ: 'TJK',
  TK: 'TKL',
  TL: 'TLS',
  TM: 'TKM',
  TN: 'TUN',
  TO: 'TON',
  TR: 'TUR',
  TT: 'TTO',
  TV: 'TUV',
  TW: 'TWN',
  TZ: 'TZA',
  UA: 'UKR',
  UG: 'UGA',
  UK: 'GBR',
  UM: 'UMI',
  US: 'USA',
  UY: 'URY',
  UZ: 'UZB',
  VA: 'VAT',
  VC: 'VCT',
  VE: 'VEN',
  VG: 'VGB',
  VI: 'VIR',
  VN: 'VNM',
  VU: 'VUT',
  WF: 'WLF',
  WS: 'WSM',
  YE: 'YEM',
  YT: 'MYT',
  ZA: 'ZAF',
  ZM: 'ZMB',
  ZW: 'ZWE',
}

/** Medusa gives ISO-2 ("gb"); Parcel2Go wants ISO-3 ("GBR"). */
export function toIso3(code?: string | null): string {
  const c = (code ?? 'GB').trim().toUpperCase()
  if (c.length === 3) return c
  return ISO2_TO_ISO3[c] ?? c
}

/* ------------------------------------------------------------------ */
/* Types (PascalCase, as returned/accepted by the API)                 */
/* ------------------------------------------------------------------ */

export type Parcel2GoVatStatus = 'Individual' | 'Business' | string

export type Parcel2GoQuoteAddress = {
  Country: string // ISO-3, e.g. "GBR"
  Property: string
  Postcode: string
  Town: string
  VatStatus?: Parcel2GoVatStatus
}

export type Parcel2GoParcel = {
  Value: number
  Weight: number // kg
  Length: number // cm
  Width: number // cm
  Height: number // cm
}

export type Parcel2GoQuoteRequest = {
  CollectionAddress: Parcel2GoQuoteAddress
  DeliveryAddress: Parcel2GoQuoteAddress
  Parcels: Parcel2GoParcel[]
}

/** VERIFY: exact shape is truncated in Swagger; kept loose on purpose. */
export type Parcel2GoQuote = {
  Service?: {
    Id?: number
    Slug?: string
    Name?: string
    CourierName?: string
    [k: string]: unknown
  }
  TotalPrice?: number
  TotalPriceExVat?: number
  [k: string]: unknown
}

export type Parcel2GoQuoteResponse = {
  Quotes?: Parcel2GoQuote[]
  [k: string]: unknown
}

/** Address as accepted by POST /orders (official example: api-docs.parcel2go.com). */
export type Parcel2GoOrderAddress = {
  ContactName: string
  Organisation?: string
  Email?: string
  Phone?: string
  Property: string
  Street: string
  Locality?: string
  Town: string
  County?: string
  Postcode: string
  /** ISO-3, e.g. "GBR" — NOT "Country" (that key is only for /quotes). */
  CountryIsoCode: string
  CountryId?: number
  SpecialInstructions?: string
}

/** In POST /orders the DELIVERY address lives inside each parcel. */
export type Parcel2GoOrderParcel = {
  Id: string
  Height: number
  Length: number
  Width: number
  Weight: number
  EstimatedValue: number
  DeliveryAddress: Parcel2GoOrderAddress
  ContentsSummary: string
}

export type Parcel2GoOrderItem = {
  /** Client-generated GUID. */
  Id: string
  /** ISO datetime from POST /collectiondates */
  CollectionDate: string
  /** Service slug from /quotes -> Quotes[].Service.Slug */
  Service: string
  Parcels: Parcel2GoOrderParcel[]
  CollectionAddress: Parcel2GoOrderAddress
  Upsells?: Array<{ Type: string; [k: string]: unknown }>
  /** Present in the sandbox Swagger example; harmless if unused. */
  OriginCountry?: string
  VatStatus?: Parcel2GoVatStatus
  RecipientVatStatus?: Parcel2GoVatStatus
}

export type Parcel2GoCreateOrderPayload = {
  Items: Parcel2GoOrderItem[]
  CustomerDetails?: { Email: string; Forename: string; Surname: string }
}

export type Parcel2GoCreateOrderResponse = {
  OrderId: string | number
  Links?: Record<string, string>
  TotalPrice?: number
  TotalVat?: number
  TotalPriceExVat?: number
  [k: string]: unknown
}

export type Parcel2GoLabelsResponse = {
  SuccessfulLabels?: number
  FailedLabels?: number
  Base64EncodedLabels?: string[]
}

export type Parcel2GoLabelOptions = {
  referenceType?: 'OrderId' | 'OrderLineId'
  detailLevel?: 'All' | 'Labels' | 'AdditionalDocuments' | 'Instructions'
  labelMedia?: 'A4' | 'Label4X6'
  labelFormat?: 'PDF' | 'PNG'
  hash?: string
}

export type Parcel2GoParcelNumbersResponse = {
  TrackingNumbers?: Array<{ ParcelId: number; TrackingNumber: string }>
}

export type Parcel2GoCollectionDatesResponse = {
  CollectionDates?: Array<{ CollectionDate: string; Surcharge: number }>
}

export type Parcel2GoTrackingResponse = {
  Results?: Array<{
    Timestamp: string
    Description: string
    Details?: string
    StatusCode?: string
    ParcelNumber?: string
    CourierId?: number
    DeliveryType?: string
  }>
}

/** Flattened view of a quote, handy for matching by slug. */
export type Parcel2GoQuoteOption = {
  slug: string
  name: string
  courier: string
  price: number
  raw: Parcel2GoQuote
}

export function extractQuoteOptions(
  res: Parcel2GoQuoteResponse,
): Parcel2GoQuoteOption[] {
  return (res.Quotes ?? [])
    .map((q) => ({
      slug: String(q.Service?.Slug ?? ''),
      name: String(q.Service?.Name ?? ''),
      courier: String(q.Service?.CourierName ?? ''),
      price: Number(q.TotalPrice ?? 0),
      raw: q,
    }))
    .filter((o) => !!o.slug)
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export class Parcel2GoClient {
  private clientId: string
  private clientSecret: string
  private authBase: string
  private apiBase: string
  senderName?: string

  private accessToken: string | null = null
  private tokenExpiresAt = 0

  constructor(config: Parcel2GoConfig) {
    this.clientId = config.clientId ?? ''
    this.clientSecret = config.clientSecret ?? ''
    this.senderName = config.senderName
    const isLive = (config.environment ?? 'live') === 'live'
    this.authBase = isLive
      ? 'https://www.parcel2go.com'
      : 'https://sandbox.parcel2go.com'
    this.apiBase = `${this.authBase}/api`
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        '[parcel2go] Missing PARCEL2GO_CLIENT_ID / PARCEL2GO_CLIENT_SECRET.',
      )
    }
    const res = await fetch(`${this.authBase}/auth/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        // 'payment' is required in addition to 'public-api' for endpoints
        // that move money (e.g. POST /orders/{id}/paywithprepay) — a
        // 'public-api'-only token gets 403 Forbidden on those calls.
        scope: 'public-api payment',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `[parcel2go] Failed to obtain access token -> ${res.status} ${text.slice(0, 300)}`,
      )
    }
    const json = (await res.json()) as {
      access_token: string
      expires_in: number
    }
    this.accessToken = json.access_token
    this.tokenExpiresAt = Date.now() + json.expires_in * 1000
    return this.accessToken
  }

  private async request<T>({
    method = 'GET',
    path,
    query,
    body,
    retries = 3,
  }: RequestOptions): Promise<T> {
    const token = await this.getAccessToken()
    await throttle()

    const qs = query
      ? '?' +
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
          )
          .join('&')
      : ''

    const res = await fetch(`${this.apiBase}${path}${qs === '?' ? '' : qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 401 && retries > 0) {
      this.accessToken = null
      return this.request<T>({
        method,
        path,
        query,
        body,
        retries: retries - 1,
      })
    }
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      await new Promise((r) => setTimeout(r, (4 - retries) * 1000 + 500))
      return this.request<T>({
        method,
        path,
        query,
        body,
        retries: retries - 1,
      })
    }

    const text = await res.text().catch(() => '')
    if (!res.ok) {
      const err: any = new Error(
        `[parcel2go] ${method} ${path} -> ${res.status} ${text.slice(0, 500)}`,
      )
      err.status = res.status
      try {
        err.parcel2goError = JSON.parse(text)
      } catch {
        /* not JSON */
      }
      throw err
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  /** GET /prepay -> plain number (GBP). */
  async getPrepayBalance(): Promise<number> {
    const res = await this.request<number | { Balance?: number }>({
      path: '/prepay',
    })
    if (typeof res === 'number') return res
    return Number((res as any)?.Balance ?? 0)
  }

  /** POST /quotes */
  async getQuotes(payload: Parcel2GoQuoteRequest) {
    return this.request<Parcel2GoQuoteResponse>({
      method: 'POST',
      path: '/quotes',
      body: payload,
    })
  }

  /** POST /collectiondates */
  async getCollectionDates(input: {
    serviceSlug: string
    address: string
    city: string
    postcode: string
    countryIso3: string
  }) {
    return this.request<Parcel2GoCollectionDatesResponse>({
      method: 'POST',
      path: '/collectiondates',
      body: {
        ServiceSlug: input.serviceSlug,
        Address: input.address,
        City: input.city,
        Postcode: input.postcode,
        CountryISO3Code: input.countryIso3,
      },
    })
  }

  /** POST /orders — creates an unpaid order. */
  async createOrder(payload: Parcel2GoCreateOrderPayload) {
    return this.request<Parcel2GoCreateOrderResponse>({
      method: 'POST',
      path: '/orders',
      body: payload,
    })
  }

  /** POST /orders/{orderId}/paywithprepay — pays from Prepay balance. */
  async payOrderWithPrepay(orderId: string | number, hash?: string) {
    return this.request<{ Links?: Array<{ Name: string; Link: string }> }>({
      method: 'POST',
      path: `/orders/${orderId}/paywithprepay`,
      query: { hash },
    })
  }

  /** GET /orders?orderId=&hash= */
  async getOrder(orderId: string | number, hash?: string) {
    return this.request<Record<string, any>>({
      path: '/orders',
      query: { orderId, hash },
    })
  }

  /** POST /orders/{orderId}/parcelnumbers */
  async getParcelNumbers(orderId: string | number) {
    return this.request<Parcel2GoParcelNumbersResponse>({
      method: 'POST',
      path: `/orders/${orderId}/parcelnumbers`,
    })
  }

  /** GET /labels/{reference} — labels come back as base64. */
  async getLabels(
    reference: string | number,
    opts: Parcel2GoLabelOptions = {},
  ) {
    return this.request<Parcel2GoLabelsResponse>({
      path: `/labels/${encodeURIComponent(String(reference))}`,
      query: {
        referenceType: opts.referenceType ?? 'OrderId',
        detailLevel: opts.detailLevel ?? 'Labels',
        labelMedia: opts.labelMedia ?? 'Label4X6',
        labelFormat: opts.labelFormat ?? 'PDF',
        hash: opts.hash,
      },
    })
  }

  /** GET /tracking/{orderLineId} */
  async getTracking(orderLineId: string | number) {
    return this.request<Parcel2GoTrackingResponse>({
      path: `/tracking/${encodeURIComponent(String(orderLineId))}`,
    })
  }
}
