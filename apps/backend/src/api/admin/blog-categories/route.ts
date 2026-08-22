import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { BLOG_MODULE } from '../../../modules/blog'
import BlogModuleService from '../../../modules/blog/service'

// GET /admin/blog-categories
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)
  const categories = await blogModuleService.listBlogCategories()
  res.json({ categories, count: categories.length })
}

// POST /admin/blog-categories
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const blogModuleService: BlogModuleService = req.scope.resolve(BLOG_MODULE)
  const body = req.body as Record<string, any>

  const category = await blogModuleService.createBlogCategories({
    name: body.name,
    slug: body.slug,
  })

  res.status(201).json({ category })
}
