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
