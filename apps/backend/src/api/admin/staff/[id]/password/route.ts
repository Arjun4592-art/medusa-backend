import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const userId = req.params.id
  const { password } = (req.body ?? {}) as { password?: string }

  if (typeof password !== 'string' || password.length < 8) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 8 characters.' })
  }

  const userService = req.scope.resolve(Modules.USER)
  const authService = req.scope.resolve(Modules.AUTH)

  let email: string
  try {
    const user = await userService.retrieveUser(userId)
    email = user.email
  } catch {
    return res.status(404).json({ error: `User ${userId} not found` })
  }

  try {
    const result: any = await authService.updateProvider('emailpass', {
      entity_id: email,
      password,
    })
    if (!result?.success) {
      return res.status(422).json({
        error:
          result?.error ??
          'Could not update the password for this user (no login found).',
      })
    }
    return res.status(200).json({ success: true })
  } catch (err: any) {
    console.error('[staff password] update failed:', err)
    return res
      .status(500)
      .json({ error: err?.message ?? 'Failed to update password.' })
  }
}
