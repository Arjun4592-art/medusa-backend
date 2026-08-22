import { model } from '@medusajs/framework/utils'
import BlogPost from './post'

const BlogCategory = model.define('blog_category', {
  id: model.id().primaryKey(),
  name: model.text(),
  slug: model.text().unique(),
  posts: model.hasMany(() => BlogPost, {
    mappedBy: 'category',
  }),
})

export default BlogCategory
