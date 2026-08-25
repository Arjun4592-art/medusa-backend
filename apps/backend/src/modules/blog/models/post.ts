import { model } from "@medusajs/framework/utils"
import BlogCategory from "./category"

const BlogPost = model.define("blog_post", {
  id: model.id().primaryKey(),
  title: model.text(),
  slug: model.text().unique(),
  excerpt: model.text().nullable(),
  content: model.text(), // stored as HTML/markdown string
  cover_image: model.text().nullable(),
  author: model.text().nullable(),
  seo_title: model.text().nullable(),
  seo_description: model.text().nullable(),
  seo_keywords: model.text().nullable(),
  status: model.enum(["draft", "published"]).default("draft"),
  published_at: model.dateTime().nullable(),
  category: model.belongsTo(() => BlogCategory, {
    mappedBy: "posts",
  }),
})

export default BlogPost