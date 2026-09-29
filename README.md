# 群聊美食地图

面向一个微信群的手机端共享地图。成员打开链接后设置昵称和颜色，可以收集地点、上传照片、评论、点赞、打分和标记去过。V1.1 已发布到原公开网址，但 2026-09-30 手机微信及系统浏览器被 Cloudflare 拦截，暂不能作为可用的群分享地址；微信与高德配置、真机验收仍待完成。

## 文档

- [PRD](./docs/PRD.md)
- [开发记录](./docs/开发记录.md)
- [问题汇总](./docs/问题汇总.md)
- [默认域名受拦截时的替代托管预案](./docs/替代托管预案.md)

## 开发

`npm install` 安装依赖，`npm run dev` 启动本地预览，`npm run build` 构建，`npm run lint` 检查代码，`npm run test:resolve` 测试链接识别，`npm run db:generate` 生成数据库迁移。

数据库结构在 `db/schema.ts`，迁移在 `drizzle/`，持久化使用 D1 和 R2。链接识别规则在 `lib/resolve.ts`，新增平台时应先收集真实分享样例。已有生产迁移文件不可改写。

## 上线配置

- `OWNER_CLAIM_CODE_HASH`：一次性群主口令的 SHA-256 哈希。明文仅交给群主，不能写入仓库。
- `AMAP_WEB_KEY` 与 `AMAP_SECURITY_JS_CODE`：高德 Web JS API Key 和安全码；两项都配置后启用高德地图。
- `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`PUBLIC_SITE_URL`：已认证服务号的网页授权配置及站点 HTTPS 根网址；确认授权域名可用后再启用。

生产环境变量由 Sites 保存，密钥应标记为 secret。新增的 `drizzle/0001_narrow_justin_hammer.sql` 已在正式 D1 生效。微信和高德配置未提供时，站点仍使用浏览器本地身份与原有底图。
