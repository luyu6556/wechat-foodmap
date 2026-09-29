# 群聊美食地图

面向一个微信群的手机端共享地图。成员打开链接后设置昵称和颜色，可以收集地点、上传照片、评论、点赞、打分和标记去过。

## 文档

- [PRD](./docs/PRD.md)
- [开发记录](./docs/开发记录.md)
- [问题汇总](./docs/问题汇总.md)

## 开发

`npm install` 安装依赖，`npm run dev` 启动本地预览，`npm run build` 构建，`npm run lint` 检查代码，`npm run db:generate` 生成数据库迁移。

数据库结构在 `db/schema.ts`，迁移在 `drizzle/`，持久化使用 D1 和 R2。链接识别规则在 `lib/resolve.ts`，新增平台时应先收集真实分享样例。已有生产迁移文件不可改写。
