import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { BLOG_MODULE } from '../../../../modules/blog'
import BlogModuleService from '../../../../modules/blog/service'

// POST /admin/blog-categories/:id — update
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)
  const body = req.body as Record<string, any>

  const category = await blogModuleService.updateBlogCategories({
    id: req.params.id,
    ...body,
  })

  res.json({ category })
}

// DELETE /admin/blog-categories/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)
  await blogModuleService.deleteBlogCategories(req.params.id)
  res.json({ id: req.params.id, object: 'blog_category', deleted: true })
}
