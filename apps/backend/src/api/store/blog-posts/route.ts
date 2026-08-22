import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { BLOG_MODULE } from '../../../modules/blog'
import BlogModuleService from '../../../modules/blog/service'

// GET /store/blog-posts — only published posts, public
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)

  const posts = await blogModuleService.listBlogPosts(
    { status: 'published' },
    { relations: ['category'], order: { published_at: 'DESC' } },
  )

  res.json({ posts, count: posts.length })
}
