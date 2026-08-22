import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { BLOG_MODULE } from '../../../../modules/blog'
import BlogModuleService from '../../../../modules/blog/service'

// GET /store/blog-posts/:slug
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)

  const posts = await blogModuleService.listBlogPosts(
    { slug: req.params.slug, status: 'published' },
    { relations: ['category'] },
  )

  if (!posts.length) {
    return res.status(404).json({ message: 'Post not found' })
  }

  res.json({ post: posts[0] })
}
