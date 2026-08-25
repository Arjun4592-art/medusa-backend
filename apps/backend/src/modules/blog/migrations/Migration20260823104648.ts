import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260823104648 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "blog_post" add column if not exists "author" text null, add column if not exists "seo_title" text null, add column if not exists "seo_description" text null, add column if not exists "seo_keywords" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "blog_post" drop column if exists "author", drop column if exists "seo_title", drop column if exists "seo_description", drop column if exists "seo_keywords";`);
  }

}
