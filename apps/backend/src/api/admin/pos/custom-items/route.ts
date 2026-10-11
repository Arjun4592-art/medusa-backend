import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  addToCartWorkflow,
  createProductsWorkflow,
  refreshCartItemsWorkflow,
  updateProductsWorkflow,
} from '@medusajs/medusa/core-flows'

const PLACEHOLDER_SKU = 'POS-CUSTOM-ITEM'
const PLACEHOLDER_HANDLE = 'pos-custom-item'

async function ensurePlaceholderVariant(
  req: MedusaRequest,
  currencyCode: string,
  cartSalesChannelId?: string | null,
): Promise<string> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existing } = await query.graph({
    entity: 'product_variant',
    fields: [
      'id',
      'product_id',
      'product.id',
      'product.status',
      'product.sales_channels.id',
    ],
    filters: { sku: PLACEHOLDER_SKU },
  })
  const found: any = existing?.[0]
  if (found?.id) {
    // Medusa's add-to-cart only accepts variants of a PUBLISHED product that
    // is in the cart's sales channel. An older placeholder may still be a
    // draft (that caused "Variants ... do not exist or belong to a product
    // that is not published"), so repair it in place.
    const product = found.product
    const channelIds: string[] = (product?.sales_channels ?? [])
      .map((c: any) => c?.id)
      .filter(Boolean)
    const needsChannel =
      !!cartSalesChannelId && !channelIds.includes(cartSalesChannelId)
    if (product?.status !== 'published' || needsChannel) {
      await updateProductsWorkflow(req.scope).run({
        input: {
          selector: { id: found.product_id ?? product?.id },
          update: {
            status: 'published',
            sales_channels: (needsChannel
              ? [...channelIds, cartSalesChannelId as string]
              : channelIds
            ).map((id) => ({ id })),
          },
        },
      } as any)
    }
    return found.id
  }

  const { data: channels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
  })
  const { data: profiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  })

  // Keep the placeholder OFF the public website: only the POS ("Store")
  // channel and the channel of the cart being sold on.
  const channelIds = new Set<string>()
  for (const c of (channels ?? []) as any[]) {
    if (
      String(c?.name ?? '')
        .toLowerCase()
        .trim() === 'store'
    ) {
      channelIds.add(c.id)
    }
  }
  if (cartSalesChannelId) channelIds.add(cartSalesChannelId)
  if (channelIds.size === 0 && channels?.[0]?.id) {
    channelIds.add((channels as any[])[0].id)
  }

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [
        {
          title: 'Custom Item',
          handle: PLACEHOLDER_HANDLE,
          // Must be published or add-to-cart rejects the variant. It is only
          // linked to the POS sales channel, so the storefront never lists it.
          status: 'published',
          shipping_profile_id: profiles?.[0]?.id,
          sales_channels: [...channelIds].map((id) => ({ id })),
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
  const { cart_id, title, unit_price, quantity, ref, gift_card } = (req.body ??
    {}) as {
    cart_id?: string
    title?: string
    unit_price?: number
    quantity?: number
    ref?: string
    /** Sale of a physical gift card: the line is exempt from VAT (VAT is
     * charged when the card is spent on items, not when it is sold). */
    gift_card?: boolean
  }
  const isGiftCardSale = gift_card === true

  const cleanTitle = String(title ?? '')
    .trim()
    .slice(0, 120)
  const price = Number(unit_price)
  const qty = Math.max(1, Math.floor(Number(quantity) || 1))

  if (!cart_id) return res.status(400).json({ error: 'cart_id is required' })
  if (!cleanTitle) return res.status(400).json({ error: 'title is required' })
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'unit_price must be 0 or more' })
  }
  if (isGiftCardSale && (qty !== 1 || price <= 0)) {
    return res
      .status(400)
      .json({ error: 'A gift card sale must be quantity 1 and above zero' })
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: 'cart',
      fields: ['id', 'currency_code', 'sales_channel_id'],
      filters: { id: cart_id },
    })
    const cart = carts?.[0]
    if (!cart) return res.status(404).json({ error: 'Cart not found' })

    const variantId = await ensurePlaceholderVariant(
      req,
      String(cart.currency_code ?? 'gbp').toLowerCase(),
      (cart as any).sales_channel_id,
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
              ...(isGiftCardSale ? { gift_card_sale: true } : {}),
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
          // Medusa leaves line items flagged `is_giftcard` out of tax-line
          // calculation, which is exactly the treatment a gift card sale
          // needs. We set it on the LINE only — not on the placeholder
          // product — so the loyalty plugin's order.placed subscriber (which
          // looks at product.is_giftcard) does not also mint a random card.
          ...(isGiftCardSale ? { is_giftcard: true } : {}),
        })
      }
    } catch (e) {
      if (isGiftCardSale) throw e
      console.warn('[custom-items] could not rename line item (non-fatal):', e)
    }

    if (isGiftCardSale) {
      // Recalculate tax lines now that the line is flagged; the lines created
      // when it was first added (before the flag) are replaced.
      await refreshCartItemsWorkflow(req.scope).run({
        input: { cart_id },
      } as any)
    }

    return res.json({ ok: true, cart_id, line_item_id: lineItemId })
  } catch (e: any) {
    console.error('[custom-items] failed:', e)
    return res
      .status(500)
      .json({ error: e?.message ?? 'Failed to add custom item' })
  }
}
