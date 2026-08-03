/**
 * POST   /admin/invoicing            body: { order_id, channel } -> allocate/return invoice number
 * GET    /admin/invoicing?order_id=  -> look up existing invoice record
 * PATCH  /admin/invoicing            body: { order_id, pdf_url }  -> attach the generated PDF's URL
 *
 * Why this lives in the Medusa backend and not the Next.js app: the
 * Next.js app (smash-output) has no direct Postgres connection — it only
 * ever talks to Medusa through its HTTP APIs, by design. UK VAT invoice
 * numbers must be sequential and gap-free, which needs an atomic
 * DB-level counter, so that counter has to live where the DB is: here.
 *
 * Uses Medusa's own Postgres connection via the request container
 * (no new DB, no separate migration tool) rather than standing up a
 * full custom module with its own migrations for two small tables —
 * proportionate to the size of this feature.
 */
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { Knex } from 'knex'

async function ensureTables(knex: Knex) {
  await knex.schema.raw(`
    CREATE TABLE IF NOT EXISTS invoice_counters (
      channel text PRIMARY KEY,
      current_number integer NOT NULL DEFAULT 0
    );
  `)
  await knex.schema.raw(`
    CREATE TABLE IF NOT EXISTS invoices (
      id serial PRIMARY KEY,
      order_id text NOT NULL UNIQUE,
      channel text NOT NULL,
      invoice_number text NOT NULL UNIQUE,
      pdf_url text,
      generated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
}

const PREFIX = process.env.INVOICE_NUMBER_PREFIX || 'INV'

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const knex: Knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { order_id, channel } = req.body as {
    order_id?: string
    channel?: string
  }

  if (!order_id || !channel) {
    return res.status(400).json({ error: 'order_id and channel are required' })
  }

  await ensureTables(knex)

  // Idempotency: if this order already has an invoice, return it as-is
  // instead of allocating a new number. A webhook retry or the same
  // event firing twice from two different trigger points (see the
  // README on why both the checkout flow and the webhook can call this)
  // must never mint two invoice numbers for one order.
  const existing = await knex('invoices').where({ order_id }).first()
  if (existing) {
    return res.json({
      invoice_number: existing.invoice_number,
      pdf_url: existing.pdf_url,
      is_new: false,
    })
  }

  const invoiceNumber = await knex.transaction(async (trx) => {
    await trx.raw(
      `INSERT INTO invoice_counters (channel, current_number) VALUES (?, 0)
       ON CONFLICT (channel) DO NOTHING`,
      [channel],
    )
    const { rows } = await trx.raw(
      `SELECT current_number FROM invoice_counters WHERE channel = ? FOR UPDATE`,
      [channel],
    )
    const next = rows[0].current_number + 1
    await trx.raw(
      `UPDATE invoice_counters SET current_number = ? WHERE channel = ?`,
      [next, channel],
    )

    const year = new Date().getFullYear()
    const number = `${PREFIX}-${year}-${String(next).padStart(6, '0')}`

    await trx.raw(
      `INSERT INTO invoices (order_id, channel, invoice_number) VALUES (?, ?, ?)`,
      [order_id, channel, number],
    )

    return number
  })

  return res.json({
    invoice_number: invoiceNumber,
    pdf_url: null,
    is_new: true,
  })
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex: Knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderId = req.query.order_id as string | undefined
  if (!orderId) {
    return res.status(400).json({ error: 'order_id query param is required' })
  }
  await ensureTables(knex)
  const row = await knex('invoices').where({ order_id: orderId }).first()
  if (!row) {
    return res.status(404).json({ error: 'No invoice found for this order' })
  }
  return res.json({
    invoice_number: row.invoice_number,
    pdf_url: row.pdf_url,
    generated_at: row.generated_at,
  })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const knex: Knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { order_id, pdf_url } = req.body as {
    order_id?: string
    pdf_url?: string
  }
  if (!order_id || !pdf_url) {
    return res.status(400).json({ error: 'order_id and pdf_url are required' })
  }
  await ensureTables(knex)
  const updated = await knex('invoices')
    .where({ order_id })
    .update({ pdf_url })
    .returning('*')
  if (updated.length === 0) {
    return res
      .status(404)
      .json({ error: 'No invoice record to attach pdf_url to' })
  }
  return res.json({ invoice_number: updated[0].invoice_number, pdf_url })
}
