
import { loadEnv } from '@medusajs/framework/utils'
import { writeFileSync } from 'fs'
import {
  Parcel2GoClient,
  extractQuoteOptions,
  splitAddressLine,
} from '../src/modules/parcel2go/client'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const environment =
  (process.env.PARCEL2GO_ENVIRONMENT as 'live' | 'sandbox') || 'live'
const line1 = process.env.PARCEL2GO_SENDER_ADDRESS_LINE1
const town = process.env.PARCEL2GO_SENDER_ADDRESS_TOWN
const postcode = process.env.PARCEL2GO_SENDER_ADDRESS_POSTCODE

// argv: [.., postcodePart1, postcodePart2, countryIso3, weightKg, L, W, H]
const args = process.argv.slice(2)
if (args.length < 6) {
  console.error(
    'Usage: npx tsx scripts/get-parcel2go-quotes-ci.ts "<postcode>" <JEY|GGY> <weightKg> <L> <W> <H>\n' +
      'e.g.   npx tsx scripts/get-parcel2go-quotes-ci.ts "JE2 3AB" JEY 1 35 25 2',
  )
  process.exitCode = 1
  process.exit()
}
const deliveryPostcode = args[0]
const deliveryCountry = args[1]
const weightKg = Number(args[2])
const lengthCm = Number(args[3])
const widthCm = Number(args[4])
const heightCm = Number(args[5])

async function main() {
  const clientId = process.env.PARCEL2GO_CLIENT_ID
  const clientSecret = process.env.PARCEL2GO_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('Set PARCEL2GO_CLIENT_ID and PARCEL2GO_CLIENT_SECRET in backend/.env first.')
    process.exitCode = 1
    return
  }
  if (!line1 || !town || !postcode) {
    console.error('Set PARCEL2GO_SENDER_ADDRESS_LINE1 / _TOWN / _POSTCODE in backend/.env first.')
    process.exitCode = 1
    return
  }

  const client = new Parcel2GoClient({ clientId, clientSecret, environment })
  console.log(`Environment: ${environment}`)
  console.log(
    `Quote: ${postcode} -> ${deliveryPostcode} (${deliveryCountry}), ${weightKg}kg, ${lengthCm}x${widthCm}x${heightCm}cm\n`,
  )

  try {
    const balance = await client.getPrepayBalance()
    console.log(`Prepay balance: £${balance}\n`)
  } catch (err: any) {
    console.warn(`Could not read Prepay balance: ${err.message}\n`)
  }

  const { property } = splitAddressLine(line1, process.env.PARCEL2GO_SENDER_ADDRESS_LINE2)

  const quote = await client.getQuotes({
    CollectionAddress: {
      Country: 'GBR',
      Property: property,
      Postcode: postcode,
      Town: town,
      VatStatus: 'Individual',
    },
    DeliveryAddress: {
      Country: deliveryCountry,
      Property: '1',
      Postcode: deliveryPostcode,
      Town: deliveryCountry === 'JEY' ? 'St Helier' : 'St Peter Port',
      VatStatus: 'Individual',
    },
    Parcels: [
      { Value: 50, Weight: weightKg, Length: lengthCm, Width: widthCm, Height: heightCm },
    ],
  })

  writeFileSync(
    `quotes-output-ci-${deliveryCountry}-${lengthCm}x${widthCm}x${heightCm}-${weightKg}kg.json`,
    JSON.stringify(quote, null, 2),
  )

  const options = extractQuoteOptions(quote)
  if (options.length) {
    console.log('Services returned (use the SLUG column):')
    console.table(
      options
        .sort((x, y) => x.price - y.price)
        .map((o) => ({
          slug: o.slug,
          name: o.name,
          courier: o.courier,
          type: o.raw?.Service?.CollectionType,
          'price inc VAT': o.price,
        })),
    )
  } else {
    console.log('No services returned — check quotes-output-ci-*.json for the raw response.')
  }
}
main().catch((e) => {
  console.error('Failed:', e.message)
  process.exit(1)
})