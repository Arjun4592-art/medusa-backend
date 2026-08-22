import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { BLOG_MODULE } from '../../../../modules/blog'
import BlogModuleService from '../../../../modules/blog/service'

// GET /admin/blog-posts/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)
  const post = await blogModuleService.retrieveBlogPost(req.params.id, {
    relations: ['category'],
  })
  res.json({ post })
}

// POST /admin/blog-posts/:id — update (edit)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)
  const body = req.body as Record<string, any>

  const post = await blogModuleService.updateBlogPosts({
    id: req.params.id,
    ...body,
    published_at:
      body.status === 'published'
        ? (body.published_at ?? new Date())
        : body.published_at,
  })

  res.json({ post })
}

// DELETE /admin/blog-posts/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)
  await blogModuleService.deleteBlogPosts(req.params.id)
  res.json({ id: req.params.id, object: 'blog_post', deleted: true })
}
