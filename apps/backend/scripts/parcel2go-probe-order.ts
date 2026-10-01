import { loadEnv } from '@medusajs/framework/utils'
import { Parcel2GoClient } from '../src/modules/parcel2go/client'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

function walk(v: any, path: string, out: string[], depth = 0) {
  if (v == null || depth > 5) return
  if (typeof v !== 'object') {
    if (/id|ref|track|link|line|url/i.test(path)) {
      out.push(`${path} = ${String(v).slice(0, 90)}`)
    }
    return
  }
  if (Array.isArray(v)) {
    v.slice(0, 3).forEach((x, i) => walk(x, `${path}[${i}]`, out, depth + 1))
    return
  }
  for (const [k, x] of Object.entries(v))
    walk(x, path ? `${path}.${k}` : k, out, depth + 1)
}

async function main() {
  const orderId = process.argv[2]
  if (!orderId) {
    console.error(
      'Usage: npx tsx scripts/parcel2go-probe-order.ts <parcel2go_order_id>',
    )
    process.exit(1)
  }
  const client: any = new Parcel2GoClient({
    clientId: process.env.PARCEL2GO_CLIENT_ID as string,
    clientSecret: process.env.PARCEL2GO_CLIENT_SECRET as string,
    environment:
      (process.env.PARCEL2GO_ENVIRONMENT as 'live' | 'sandbox') || 'live',
    senderName: process.env.PARCEL2GO_SENDER_COMPANY_NAME,
  })
  const attempts: Array<{ method: 'GET' | 'POST'; path: string; query?: any }> =
    [
      { method: 'GET', path: `/orders/${orderId}` },
      { method: 'GET', path: `/orders/${orderId}/status` },
      { method: 'GET', path: `/orders/${orderId}/lines` },
      { method: 'GET', path: `/orders/${orderId}/orderlines` },
      { method: 'GET', path: `/orders/${orderId}/tracking` },
      { method: 'GET', path: `/orders/${orderId}/links` },
      { method: 'POST', path: `/orders/${orderId}/parcelnumbers` },
      {
        method: 'GET',
        path: `/labels/${orderId}`,
        query: {
          referenceType: 'OrderId',
          detailLevel: 'All',
          labelFormat: 'PDF',
        },
      },
    ]
  for (const a of attempts) {
    const tag = `${a.method} ${a.path}`
    try {
      const res = await client.request(a)
      const out: string[] = []
      walk(res, '', out)
      console.log(`OK    ${tag}`)
      out.slice(0, 25).forEach((l) => console.log('        ', l))
    } catch (e: any) {
      console.log(
        `FAIL  ${tag} -> ${String(e?.parcel2goError?.Message ?? e?.message ?? e).slice(0, 120)}`,
      )
    }
  }
}

main().catch((e) => {
  console.error(e?.parcel2goError ?? e)
  process.exit(1)
})
