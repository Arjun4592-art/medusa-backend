import { loadEnv } from '@medusajs/framework/utils'
import {
  Parcel2GoClient,
  extractQuoteOptions,
  splitAddressLine,
} from '../src/modules/parcel2go/client'
import { pickEstimatedDelivery } from '../src/modules/parcel2go/estimate'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const deliveryPostcode = process.argv[2] || 'M22 9YL'
const weightKg = Number(process.argv[3] || 0.9)
const lengthCm = Number(process.argv[4] || 45)
const widthCm = Number(process.argv[5] || 35)
const heightCm = Number(process.argv[6] || 16)

function interesting(obj: any) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (
      /deliver|transit|estimate|days|time|collect/i.test(k) &&
      typeof v !== 'object'
    ) {
      out[k] = v
    }
  }
  return out
}

async function main() {
  const line1 = process.env.PARCEL2GO_SENDER_ADDRESS_LINE1
  const town = process.env.PARCEL2GO_SENDER_ADDRESS_TOWN
  const postcode = process.env.PARCEL2GO_SENDER_ADDRESS_POSTCODE
  if (!line1 || !town || !postcode) {
    console.error(
      'Set PARCEL2GO_SENDER_ADDRESS_LINE1 / _TOWN / _POSTCODE in .env first.',
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
  const { property } = splitAddressLine(
    line1,
    process.env.PARCEL2GO_SENDER_ADDRESS_LINE2,
  )
  const quote = await client.getQuotes({
    CollectionAddress: {
      Country: 'GBR',
      Property: property,
      Postcode: postcode,
      Town: town,
      VatStatus: 'Individual',
    },
    DeliveryAddress: {
      Country: 'GBR',
      Property: '1',
      Postcode: deliveryPostcode,
      Town: 'London',
      VatStatus: 'Individual',
    },
    Parcels: [
      {
        Value: 50,
        Weight: weightKg,
        Length: lengthCm,
        Width: widthCm,
        Height: heightCm,
      },
    ],
  })
  const options = extractQuoteOptions(quote).sort((a, b) => a.price - b.price)
  console.log(
    `Nothing is booked or paid. ${options.length} services returned.\n`,
  )
  for (const o of options.slice(0, 8)) {
    const est = pickEstimatedDelivery(o.raw)
    console.log(`${o.courier} / ${o.name}  (£${o.price})  slug=${o.slug}`)
    console.log('  estimated ->', est.date.slice(0, 10), `[${est.source}]`)
    console.log('  quote fields   :', JSON.stringify(interesting(o.raw)))
    console.log(
      '  service fields :',
      JSON.stringify(interesting((o.raw as any).Service)),
    )
  }
}

main().catch((e) => {
  console.error(e?.parcel2goError ?? e)
  process.exit(1)
})
