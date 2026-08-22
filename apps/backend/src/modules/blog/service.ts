import { MedusaService } from '@medusajs/framework/utils'
import BlogPost from './models/post'
import BlogCategory from './models/category'

class BlogModuleService extends MedusaService({
  BlogPost,
  BlogCategory,
}) {}

export default BlogModuleService
