import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  wechatOpenId: text("wechat_openid").unique(),
  isOwner: integer("is_owner").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const memberSessions = sqliteTable("member_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  createdAt: integer("created_at").notNull(),
});

export const oauthStates = sqliteTable("oauth_states", {
  id: text("id").primaryKey(),
  memberId: text("member_id").references(() => members.id),
  createdAt: integer("created_at").notNull(),
});

export const places = sqliteTable("places", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  category: text("category").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  sourceText: text("source_text").notNull().default(""),
  sourceUrl: text("source_url"),
  sourcePlatform: text("source_platform").notNull().default("manual"),
  // 菜系/品类，例如「新疆菜」「东北家常菜」。与 category（美食/玩乐）语义不同，故单列。
  cuisine: text("cuisine").notNull().default(""),
  // 以下三项来自截图识别的第三方平台数据，都可能为空——截图上没有就必须留空，不能编造。
  platformRating: real("platform_rating"),
  ratingCount: integer("rating_count"),
  avgPrice: integer("avg_price"),
  // 模型读到的原始文字，供用户核对识别是否读错。
  sourceRaw: text("source_raw").notNull().default(""),
  createdBy: text("created_by").notNull().references(() => members.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const likes = sqliteTable("likes", {
  placeId: text("place_id").notNull().references(() => places.id),
  memberId: text("member_id").notNull().references(() => members.id),
  createdAt: integer("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.placeId, table.memberId] })]);

export const visits = sqliteTable("visits", {
  placeId: text("place_id").notNull().references(() => places.id),
  memberId: text("member_id").notNull().references(() => members.id),
  createdAt: integer("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.placeId, table.memberId] })]);

export const ratings = sqliteTable("ratings", {
  placeId: text("place_id").notNull().references(() => places.id),
  memberId: text("member_id").notNull().references(() => members.id),
  score: integer("score").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.placeId, table.memberId] })]);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull().references(() => places.id),
  memberId: text("member_id").notNull().references(() => members.id),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull().references(() => places.id),
  memberId: text("member_id").notNull().references(() => members.id),
  objectKey: text("object_key").notNull(),
  mime: text("mime").notNull(),
  createdAt: integer("created_at").notNull(),
});
