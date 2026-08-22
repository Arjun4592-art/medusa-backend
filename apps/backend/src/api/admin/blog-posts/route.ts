import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { BLOG_MODULE } from '../../../modules/blog'
import BlogModuleService from '../../../modules/blog/service'

// GET /admin/blog-posts — list all posts (with optional ?status= filter)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)

  const filters: Record<string, unknown> = {}
  if (req.query.status) {
    filters.status = req.query.status
  }

  const posts = await blogModuleService.listBlogPosts(filters, {
    relations: ['category'],
    order: { published_at: 'DESC' },
  })

  res.json({ posts, count: posts.length })
}

// POST /admin/blog-posts — create a new post
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)

  const body = req.body as Record<string, any>

  const post = await blogModuleService.createBlogPosts({
    title: body.title,
    slug: body.slug,
    excerpt: body.excerpt ?? null,
    content: body.content,
    cover_image: body.cover_image ?? null,
    status: body.status ?? 'draft',
    published_at:
      body.status === 'published' ? (body.published_at ?? new Date()) : null,
    category_id: body.category_id ?? null,
  })

  res.status(201).json({ post })
}
