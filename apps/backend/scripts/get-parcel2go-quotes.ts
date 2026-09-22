/**
 * Read-only helper: checks your Prepay balance, asks Parcel2Go for a quote and
 * lists the service SLUGS it returns, so you can fill in
 * PARCEL2GO_SERVICE_ID_STANDARD / _EXPRESS / _RETURN in backend/.env.
 *
 * Place at: backend/scripts/get-parcel2go-quotes.ts
 * Run (from backend/):
 *   npx tsx scripts/get-parcel2go-quotes.ts [deliveryPostcode] [weightKg] [Lcm] [Wcm] [Hcm]
 *   e.g. npx tsx scripts/get-parcel2go-quotes.ts "EC1A 1BB" 1 35 25 2   (large letter)
 *        npx tsx scripts/get-parcel2go-quotes.ts "EC1A 1BB" 2 45 35 16  (small parcel)
 *        npx tsx scripts/get-parcel2go-quotes.ts "EC1A 1BB" 2 80 35 15  (racket)
 *
 * Needs in backend/.env: PARCEL2GO_CLIENT_ID, PARCEL2GO_CLIENT_SECRET,
 * PARCEL2GO_ENVIRONMENT (use "sandbox" with sandbox credentials),
 * PARCEL2GO_SENDER_ADDRESS_LINE1 / _TOWN / _POSTCODE.
 *
 * Nothing here books or pays for anything.
 *
 * The full raw quote response is saved to quotes-output.json — if the slug
 * table below comes out empty, open that file and look for the field that
 * identifies each service.
 */
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

const deliveryPostcode = process.argv[2] || 'EC1A 1BB'
const weightKg = Number(process.argv[3] || 1)
const lengthCm = Number(process.argv[4] || 80)
const widthCm = Number(process.argv[5] || 35)
const heightCm = Number(process.argv[6] || 15)

async function main() {
  const clientId = process.env.PARCEL2GO_CLIENT_ID
  const clientSecret = process.env.PARCEL2GO_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error(
      'Set PARCEL2GO_CLIENT_ID and PARCEL2GO_CLIENT_SECRET in backend/.env first.',
    )
    process.exitCode = 1
    return
  }
  if (!line1 || !town || !postcode) {
    console.error(
      'Set PARCEL2GO_SENDER_ADDRESS_LINE1 / _TOWN / _POSTCODE in backend/.env first.',
    )
    process.exitCode = 1
    return
  }

  const client = new Parcel2GoClient({ clientId, clientSecret, environment })
  console.log(`Environment: ${environment}`)
  console.log(
    `Quote: ${postcode} -> ${deliveryPostcode}, ${weightKg}kg, ${lengthCm}x${widthCm}x${heightCm}cm\n`,
  )

  try {
    const balance = await client.getPrepayBalance()
    console.log(`Prepay balance: £${balance}\n`)
  } catch (err: any) {
    console.warn(`Could not read Prepay balance: ${err.message}\n`)
  }

  const { property } = splitAddressLine(
    line1,
    process.env.PARCEL2GO_SENDER_ADDRESS_LINE2,
  )

  // Address keys come from the Swagger example (Country, Property, Postcode,
  // Town, VatStatus). Parcels[] field names are NOT confirmed yet — if the API
  // answers 400 "The request is invalid.", that is the first thing to adjust.
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

  writeFileSync(
    `quotes-output-${lengthCm}x${widthCm}x${heightCm}-${weightKg}kg.json`,
    JSON.stringify(quote, null, 2),
  )

  const options = extractQuoteOptions(quote)
  if (options.length) {
    console.log('Services returned (use the SLUG column in .env):')
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
    const wanted = options
      .filter((o) =>
        /fedex|royal\s*mail/i.test(`${o.courier} ${o.name} ${o.slug}`),
      )
      .sort((x, y) => x.price - y.price)
    console.log('\nFedEx / Royal Mail only:')
    if (wanted.length) {
      console.table(
        wanted.map((o) => ({
          slug: o.slug,
          name: o.name,
          type: o.raw?.Service?.CollectionType,
          price: o.price,
        })),
      )
    } else {
      console.log('  none offered for this size/weight')
    }
  } else {
    console.log(
      'No services found. Open quotes-output.json and check the shape.',
    )
  }
  console.log('\nFull raw response saved to quotes-output-<size>-<weight>.json')
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exitCode = 1
})
