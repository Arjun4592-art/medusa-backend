import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * GET /admin/pos/gift-cards/balance?code=GC00050
 *
 * Real remaining balance of a gift card, for the POS.
 *
 * Why this exists: with @medusajs/loyalty-plugin a gift card's `value` is its
 * ORIGINAL face value and never goes down. The spendable balance lives on the
 * card's backing store-credit account (the same lookup the plugin's own
 * add-gift-card-to-cart workflow does), so reading `value` makes a spent card
 * look full. This route does the exact lookup the plugin does.
 *
 * Exact code match only — no fuzzy search.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const code = String(req.query.code ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
  if (!code) return res.status(400).json({ error: 'code is required' })

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const {
      data: [giftCard],
    } = await query.graph({
      entity: 'gift_card',
      filters: { code },
      fields: [
        'id',
        'code',
        'status',
        'value',
        'currency_code',
        'expires_at',
        'reference',
        'reference_id',
      ],
    })

    if (!giftCard) return res.json({ found: false })

    const {
      data: [link],
    } = await query.graph({
      entity: 'gift_card_store_credit_account',
      filters: { gift_card_id: giftCard.id },
      fields: ['id', 'store_credit_account_id'],
    })

    // A card with no backing account can't be spent (the plugin's cart
    // workflow would fail on it), so report a zero balance.
    let balance = 0
    if (link?.store_credit_account_id) {
      const {
        data: [account],
      } = await query.graph({
        entity: 'store_credit_account',
        filters: { id: link.store_credit_account_id },
        fields: ['id', 'balance'],
      })
      // `balance` is computed at runtime by the store-credit module, but the
      // generated entity type (StoreCreditAccount) doesn't declare it, so we
      // read it through a narrow type instead of failing `medusa build`.
      balance = Number(
        (account as { balance?: number | string } | undefined)?.balance ?? 0
      )
    }

    return res.json({
      found: true,
      id: giftCard.id,
      code: giftCard.code,
      status: giftCard.status,
      currency_code: giftCard.currency_code,
      expires_at: giftCard.expires_at ?? null,
      value: Number(giftCard.value),
      balance,
      has_account: Boolean(link?.store_credit_account_id),
    })
  } catch (e: any) {
    console.error('[pos gift-card balance] failed:', e)
    return res
      .status(500)
      .json({ error: e?.message ?? 'Gift card balance lookup failed' })
  }
}