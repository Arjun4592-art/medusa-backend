/**
 * POST /admin/staff-activity  body: { staff_id, staff_name?, action, surface, detail? }
 * GET  /admin/staff-activity  ?since=ISO_DATE&limit=100&staff_id=...
 *
 * Server-side staff activity log (login/logout, extensible to sale/void/
 * pin_change later). Lives here rather than in the Next.js app's local
 * Zustand store because that store is per-browser (persisted to
 * localStorage) — a staff member logging into the POS on the shop floor
 * and the owner checking the dashboard on their laptop were never the
 * same "device", so nothing ever showed up as a real login. This table
 * is the single cross-device source of truth.
 *
 * Same pattern as src/api/admin/invoicing/route.ts — Medusa's own
 * Postgres connection via the request container, no separate module/
 * migration needed for a table this small.
 */
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { Knex } from 'knex'

const VALID_ACTIONS = ['login', 'logout', 'return'] as const
const VALID_SURFACES = ['dashboard', 'pos'] as const

async function ensureTable(knex: Knex) {
  await knex.schema.raw(`
    CREATE TABLE IF NOT EXISTS staff_activity_log (
      id serial PRIMARY KEY,
      staff_id text NOT NULL,
      staff_name text,
      action text NOT NULL,
      surface text NOT NULL,
      detail text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS staff_activity_log_created_at_idx
      ON staff_activity_log (created_at DESC);
  `)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const knex: Knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { staff_id, staff_name, action, surface, detail } = req.body as {
    staff_id?: string
    staff_name?: string
    action?: string
    surface?: string
    detail?: string
  }

  if (!staff_id || !action || !surface) {
    return res
      .status(400)
      .json({ error: 'staff_id, action, and surface are required' })
  }
  if (!VALID_ACTIONS.includes(action as any)) {
    return res
      .status(400)
      .json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` })
  }
  if (!VALID_SURFACES.includes(surface as any)) {
    return res
      .status(400)
      .json({ error: `surface must be one of: ${VALID_SURFACES.join(', ')}` })
  }

  await ensureTable(knex)

  const [row] = await knex('staff_activity_log')
    .insert({
      staff_id,
      staff_name: staff_name ?? null,
      action,
      surface,
      detail: detail ?? null,
    })
    .returning('*')

  return res.json({ entry: row })
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex: Knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await ensureTable(knex)

  const since = req.query.since as string | undefined
  const staffId = req.query.staff_id as string | undefined
  const limit = Math.min(Number(req.query.limit) || 200, 1000)

  let query = knex('staff_activity_log')
    .orderBy('created_at', 'desc')
    .limit(limit)
  if (since) query = query.where('created_at', '>=', since)
  if (staffId) query = query.where({ staff_id: staffId })

  const rows = await query
  return res.json({ entries: rows })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const knex: Knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await ensureTable(knex)
  const deleted = await knex('staff_activity_log').del()
  return res.json({ deleted })
}
