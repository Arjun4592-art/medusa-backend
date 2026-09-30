import { loadEnv } from '@medusajs/framework/utils'
import { Parcel2GoClient } from '../src/modules/parcel2go/client'
import { fetchCourierEvents } from '../src/modules/parcel2go/tracking'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error(
      'Usage: npx tsx scripts/parcel2go-tracking-test.ts <P2G reference number | parcel2go_order_id>',
    )
    process.exit(1)
  }
  const client = new Parcel2GoClient({
    clientId: process.env.PARCEL2GO_CLIENT_ID as string,
    clientSecret: process.env.PARCEL2GO_CLIENT_SECRET as string,
    environment:
      (process.env.PARCEL2GO_ENVIRONMENT as 'live' | 'sandbox') || 'live',
    senderName: process.env.PARCEL2GO_SENDER_COMPANY_NAME,
  })
  const { lineId, events, attempts } = await fetchCourierEvents(client, id, {
    tracking_number: /^P2G/i.test(id) ? id : undefined,
  })
  console.log('--- ids tried ---')
  for (const a of attempts) {
    console.log(a.ok ? 'OK   ' : 'FAIL ', a.id, a.error ? `-> ${a.error}` : '')
  }
  console.log('--- id that worked ---', lineId ?? 'none')
  console.log('--- tracking events ---')
  console.log(JSON.stringify(events, null, 2))
}

main().catch((e) => {
  console.error(e?.parcel2goError ?? e)
  process.exit(1)
})
