export type EstimatedDelivery = {
  date: string
  source: 'courier' | 'fallback'
}

export function addBusinessDays(from: Date, days: number) {
  const d = new Date(from)
  let left = Math.max(0, Math.round(days))
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
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
        const d = new Date(v)
        if (!isNaN(d.getTime()))
          return { date: d.toISOString(), source: 'courier' }
      }
    }
  }
  const start = collectionDate ? new Date(collectionDate) : new Date()
  const base = isNaN(start.getTime()) ? new Date() : start
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

export function findP2gRef(obj: unknown, depth = 0): string | undefined {
  if (obj == null || depth > 6) return undefined
  if (typeof obj === 'string') return /^P2G\d{6,}$/i.test(obj) ? obj : undefined
  if (typeof obj !== 'object') return undefined
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = findP2gRef(v, depth + 1)
    if (r) return r
  }
  return undefined
}
