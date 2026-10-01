export type EstimatedDelivery = {
  date: string
  source: 'courier' | 'fallback'
}

export function toCalendarDate(value: string | Date): Date | null {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0))
  }
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  )
}

export function addBusinessDays(from: Date, days: number) {
  const d = new Date(from)
  let left = Math.max(0, Math.round(days))
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) left--
  }
  return d
}

function maxInt(v: unknown) {
  const nums = String(v).match(/\d+/g)
  if (!nums) return undefined
  const n = Math.max(...nums.map(Number))
  return n >= 1 && n <= 15 ? n : undefined
}

export function pickEstimatedDelivery(
  quote: any,
  collectionDate?: string,
): EstimatedDelivery {
  const sources = [quote, quote?.Service]
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    for (const [k, v] of Object.entries(src)) {
      if (
        /estimated.*deliver|deliver.*(date|by)/i.test(k) &&
        typeof v === 'string'
      ) {
        const d = toCalendarDate(v)
        if (d) return { date: d.toISOString(), source: 'courier' }
      }
    }
  }
  const base =
    (collectionDate ? toCalendarDate(collectionDate) : null) ??
    toCalendarDate(new Date()) ??
    new Date()
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    for (const [k, v] of Object.entries(src)) {
      if (
        /transit|delivery.?days|delivery.?time|delivery.?estimate/i.test(k) &&
        v != null &&
        typeof v !== 'object'
      ) {
        const n = maxInt(v)
        if (n) {
          return {
            date: addBusinessDays(base, n).toISOString(),
            source: 'courier',
          }
        }
      }
    }
  }
  const fallbackDays =
    Number(process.env.PARCEL2GO_FALLBACK_TRANSIT_DAYS ?? 3) || 3
  return {
    date: addBusinessDays(base, fallbackDays).toISOString(),
    source: 'fallback',
  }
}

function digitsFrom(v: unknown, depth = 0): string | undefined {
  if (v == null || depth > 6) return undefined
  if (typeof v === 'number')
    return Number.isInteger(v) && v > 99999 ? String(v) : undefined
  if (typeof v === 'string') {
    const m = v.match(/(?:P2G)?(\d{6,})/i)
    return m ? m[1] : undefined
  }
  if (typeof v !== 'object') return undefined
  const entries = Object.entries(v as Record<string, unknown>)
  for (const [k, x] of entries) {
    const fromKey = k.match(/(?:P2G)?(\d{6,})/i)
    if (fromKey && Array.isArray(v) === false && typeof x !== 'object')
      return fromKey[1]
    const r = digitsFrom(x, depth + 1)
    if (r) return r
  }
  return undefined
}

export function findP2gRef(obj: unknown, depth = 0): string | undefined {
  if (obj == null || typeof obj !== 'object' || depth > 6) return undefined
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/order.?line/i.test(k)) {
      const r = digitsFrom(v)
      if (r) return r
    }
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (typeof v === 'string') {
      const m = v.match(/P2G(\d{6,})/i)
      if (m) return m[1]
      if (/tracking/i.test(v)) {
        const t = v.match(/(\d{7,})/)
        if (t) return t[1]
      }
    }
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = findP2gRef(v, depth + 1)
    if (r) return r
  }
  return undefined
}
