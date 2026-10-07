import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  addToCartWorkflow,
  createProductsWorkflow,
} from '@medusajs/medusa/core-flows'

const PLACEHOLDER_SKU = 'POS-CUSTOM-ITEM'
const PLACEHOLDER_HANDLE = 'pos-custom-item'

async function ensurePlaceholderVariant(
  req: MedusaRequest,
  currencyCode: string,
): Promise<string> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existing } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'product_id'],
    filters: { sku: PLACEHOLDER_SKU },
  })
  if (existing?.[0]?.id) return existing[0].id

  const { data: channels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id'],
  })
  const { data: profiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  })

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [
        {
          title: 'Custom Item',
          handle: PLACEHOLDER_HANDLE,
          // draft: never listed on the storefront
          status: 'draft',
          shipping_profile_id: profiles?.[0]?.id,
          sales_channels: (channels ?? []).map((c: any) => ({ id: c.id })),
          options: [{ title: 'Default', values: ['Default'] }],
          variants: [
            {
              title: 'Default',
              sku: PLACEHOLDER_SKU,
              manage_inventory: false,
              allow_backorder: true,
              options: { Default: 'Default' },
              prices: [{ amount: 0, currency_code: currencyCode }],
            },
          ],
          metadata: { pos_custom_item: true },
        },
      ],
    } as any,
  })

  const variantId = (result as any)?.[0]?.variants?.[0]?.id
  if (!variantId) {
    throw new Error('Could not create the custom item placeholder product')
  }
  return variantId
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { cart_id, title, unit_price, quantity, ref } = (req.body ??
    {}) as {
    cart_id?: string
    title?: string
    unit_price?: number
    quantity?: number
    ref?: string
  }

  const cleanTitle = String(title ?? '').trim().slice(0, 120)
  const price = Number(unit_price)
  const qty = Math.max(1, Math.floor(Number(quantity) || 1))

  if (!cart_id) return res.status(400).json({ error: 'cart_id is required' })
  if (!cleanTitle) return res.status(400).json({ error: 'title is required' })
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'unit_price must be 0 or more' })
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: 'cart',
      fields: ['id', 'currency_code'],
      filters: { id: cart_id },
    })
    const cart = carts?.[0]
    if (!cart) return res.status(404).json({ error: 'Cart not found' })

    const variantId = await ensurePlaceholderVariant(
      req,
      String(cart.currency_code ?? 'gbp').toLowerCase(),
    )

    // `ref` keeps two identical custom lines from being merged into one.
    const lineRef = ref || `custom-${Date.now()}`
    await addToCartWorkflow(req.scope).run({
      input: {
        cart_id,
        items: [
          {
            variant_id: variantId,
            quantity: qty,
            unit_price: price,
            metadata: {
              custom_item: true,
              custom_title: cleanTitle,
              custom_ref: lineRef,
            },
          },
        ],
      } as any,
    })

    // Show the real name on the order / receipt instead of "Custom Item".
    // Non-fatal: metadata.custom_title is the fallback the POS reads.
    let lineItemId: string | undefined
    try {
      const { data: after } = await query.graph({
        entity: 'cart',
        fields: ['id', 'items.id', 'items.metadata'],
        filters: { id: cart_id },
      })
      const line = (after?.[0]?.items ?? []).find(
        (i: any) => i?.metadata?.custom_ref === lineRef,
      )
      lineItemId = line?.id
      if (line?.id) {
        const cartModule: any = req.scope.resolve(Modules.CART)
        await cartModule.updateLineItems(line.id, {
          title: cleanTitle,
          product_title: cleanTitle,
        })
      }
    } catch (e) {
      console.warn('[custom-items] could not rename line item (non-fatal):', e)
    }

    return res.json({ ok: true, cart_id, line_item_id: lineItemId })
  } catch (e: any) {
    console.error('[custom-items] failed:', e)
    return res
      .status(500)
      .json({ error: e?.message ?? 'Failed to add custom item' })
  }
}
