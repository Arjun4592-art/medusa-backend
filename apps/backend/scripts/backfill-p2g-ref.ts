import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { readFileSync } from 'fs'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') {
        quoted = false
      } else {
        cell += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else {
      cell += c
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    if (row.some((x) => x.trim() !== '')) rows.push(row)
  }
  return rows
}

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()

export default async function backfillP2gRef({ container, args }: ExecArgs) {
  const file = args.find((a) => a.toLowerCase() !== 'apply')
  const apply = args.some((a) => a.toLowerCase() === 'apply')
  if (!file) {
    console.error(
      'Usage: npx medusa exec ./scripts/backfill-p2g-ref.ts <path-to-All_Orders.csv> [apply]',
    )
    return
  }

  const csv = parseCsv(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  const header = csv[0].map((h) => h.trim())
  const col = (name: string) => header.indexOf(name)
  const iRef = col('Reference')
  const iTn = col('TrackingNumber')
  const iPc = col('Postcode')
  const iCreated = col('Created')
  if (iRef < 0 || iTn < 0) {
    console.error('CSV must have Reference and TrackingNumber columns.')
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
  const { data: orders } = await query.graph({
    entity: 'order',
    filters: { created_at: { $gte: since } },
    fields: [
      'id',
      'display_id',
      'shipping_address.postal_code',
      'fulfillments.id',
      'fulfillments.data',
      'fulfillments.canceled_at',
    ],
    pagination: { take: 1000, order: { created_at: 'DESC' } },
  })

  const byTracking = new Map<string, { order: any; fulfillment: any }>()
  for (const o of orders as any[]) {
    for (const f of o.fulfillments ?? []) {
      if (f?.canceled_at) continue
      const tn = norm(f?.data?.tracking_number)
      if (tn) byTracking.set(tn, { order: o, fulfillment: f })
    }
  }

  const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as any
  let matched = 0
  let updated = 0
  let already = 0
  const unmatched: string[] = []

  for (const r of csv.slice(1)) {
    const ref = String(r[iRef] ?? '').trim()
    const digits = ref.replace(/^P2G/i, '')
    const tn = norm(r[iTn])
    if (!digits) continue
    const hit = byTracking.get(tn)
    if (!hit) {
      unmatched.push(
        `${ref}  tracking=${r[iTn] ?? ''}  postcode=${iPc >= 0 ? r[iPc] : ''}  created=${iCreated >= 0 ? r[iCreated] : ''}`,
      )
      continue
    }
    matched++
    const data = hit.fulfillment.data ?? {}
    if (String(data.parcel2go_ref ?? '') === digits) {
      already++
      console.log(`= order #${hit.order.display_id}  ${ref}  (already set)`)
      continue
    }
    console.log(
      `${apply ? '✔' : '•'} order #${hit.order.display_id}  ${ref}  ${apply ? 'saved' : 'would save'}`,
    )
    if (apply) {
      await fulfillmentModule.updateFulfillment(hit.fulfillment.id, {
        data: { ...data, parcel2go_ref: digits },
      })
      updated++
    }
  }

  console.log(
    `\n${apply ? 'APPLIED' : 'DRY RUN'}: ${matched} matched, ${updated} updated, ${already} already set, ${unmatched.length} not matched`,
  )
  if (unmatched.length) {
    console.log(
      '\nNot matched (no fulfilled order with this courier tracking number):',
    )
    unmatched.forEach((u) => console.log('  ', u))
  }
  if (!apply && matched - already > 0) {
    console.log('\nRe-run with the word "apply" at the end to save these.')
  }
}
