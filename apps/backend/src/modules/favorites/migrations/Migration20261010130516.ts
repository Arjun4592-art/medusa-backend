import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261010130516 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "wishlist_item" drop constraint if exists "wishlist_item_customer_id_product_id_unique";`);
    this.addSql(`alter table if exists "pos_favorite_tab" drop constraint if exists "pos_favorite_tab_tab_key_unique";`);
    this.addSql(`alter table if exists "pos_favorite" drop constraint if exists "pos_favorite_tab_key_product_id_unique";`);
    this.addSql(`create table if not exists "pos_favorite" ("id" text not null, "tab_key" text not null, "product_id" text not null, "position" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pos_favorite_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_favorite_deleted_at" ON "pos_favorite" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pos_favorite_tab_key_product_id_unique" ON "pos_favorite" ("tab_key", "product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_favorite_tab_key" ON "pos_favorite" ("tab_key") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "pos_favorite_tab" ("id" text not null, "tab_key" text not null, "label" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "pos_favorite_tab_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pos_favorite_tab_tab_key_unique" ON "pos_favorite_tab" ("tab_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_favorite_tab_deleted_at" ON "pos_favorite_tab" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "wishlist_item" ("id" text not null, "customer_id" text not null, "product_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "wishlist_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_item_deleted_at" ON "wishlist_item" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wishlist_item_customer_id_product_id_unique" ON "wishlist_item" ("customer_id", "product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_item_customer_id" ON "wishlist_item" ("customer_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "pos_favorite" cascade;`);

    this.addSql(`drop table if exists "pos_favorite_tab" cascade;`);

    this.addSql(`drop table if exists "wishlist_item" cascade;`);
  }

}
