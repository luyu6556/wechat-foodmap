# 群聊美食地图

面向一个微信群的手机端共享地图。成员打开链接后设置昵称和颜色，可以收集地点、上传照片、评论、点赞、打分和标记去过。链接与文案识别之外还提供**截图识别**兜底：上传美团／点评截图即可自动提取店名、品类、评分、人均并定位（截图不入库）。V1.1 已发布到 WorkBuddy 站点托管：`https://qunliao-food-map.app.workbuddy.host/`（2026-09-30）。原 ChatGPT Sites 域名被 Cloudflare 边缘拦截，`workers.dev` 在国内被 DNS 污染，两条旧路径均已作废。底图已于 2026-10-01 切换到高德并实测出图；手机真机验收与微信授权配置仍待完成。

## 文档

- [PRD](./docs/PRD.md)
- [开发记录](./docs/开发记录.md)
- [问题汇总](./docs/问题汇总.md)
- [默认域名受拦截时的替代托管预案](./docs/替代托管预案.md)

## 开发

`npm install` 安装依赖，`npm run dev` 启动本地预览，`npm run build` 构建，`npm run lint` 检查代码，`npm run test:resolve` 测试链接识别，`npm run db:generate` 生成数据库迁移。

数据库结构在 `db/schema.ts`，迁移在 `drizzle/`，持久化使用 D1 和 R2。链接识别规则在 `lib/resolve.ts`，截图识别在 `lib/vision.ts`（智谱 `glm-4v-flash`），服务端定位在 `lib/geo.ts`（百度，BD-09 转 WGS-84 后入库），新增平台时应先收集真实分享样例。已有生产迁移文件不可改写。

## 上线配置

发布到 WorkBuddy 站点托管时，启动命令为 `node scripts/sandbox-serve.mjs`，安装命令为 `npm ci && npm run build`。该脚本负责：状态目录（默认 `$HOME/.qunliao-food-map/state`，**必须在项目目录之外**，否则每次重新部署都会覆盖群数据）、首次启动自动应用 `drizzle/` 迁移、绑定 `0.0.0.0:$PORT`、加载 `.dev.vars`。

- `OWNER_CLAIM_CODE_HASH`：一次性群主口令的 SHA-256 哈希，写在本地 `.dev.vars`（已被 Git 忽略）。明文仅交给群主，不能写入仓库或部署命令。
- `ZHIPU_API_KEY`：智谱 API Key，用于截图识别的视觉模型调用；可配 `ZHIPU_VISION_MODEL` 覆盖默认模型。
- `BAIDU_MAP_AK`、`DEFAULT_CITY`：百度地图服务端 AK（白名单填 `0.0.0.0/0`）与默认城市（当前「深圳」）。AK 只在服务端使用，不下发前端。
- `AMAP_WEB_KEY`：高德 Web JS API Key，用于**前台底图**（已配置，2026-10-01 实测出图）。**会下发到前端**——高德 JS API 的固有限制，靠控制台域名白名单限制。
- `AMAP_SECURITY_JS_CODE`：高德安全密钥，**可选**。2021-12-02 之后新建的 Key 必须配；当前这把 Key 早于该日期，不需要。配了就走同源代理、由服务端注入 jscode（密钥不出服务端）；不配则前端直连高德。**只影响底图，不影响定位。**
- `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`PUBLIC_SITE_URL`：已认证服务号的网页授权配置及站点 HTTPS 根网址；确认授权域名可用后再启用。

成员令牌通过 `X-Food-Map-Token` 请求头发送（客户端 `lib/client-api.ts` 发送，服务端 `lib/server.ts` 读取）。**不要改回 `Authorization`**：WorkBuddy 站点的反向代理会用自带 bearer 覆盖该头，应用将永远收不到身份。`Authorization` 仅作为本机与其它托管的兼容路径保留。

生产环境变量由 Sites 保存，密钥应标记为 secret。与其它托管不同，本项目的启动脚本用 `--env-file=.dev.vars` 显式加载项目根目录的 `.dev.vars`（该文件已被 Git 忽略，但**会随项目目录一起上传**），因此线上能否拿到密钥取决于部署时是否带上它——**每次部署后都应复查 `/api/map/config` 是否已返回 `amap`**。`drizzle/0001_narrow_justin_hammer.sql` 与 `0002_cuddly_silver_samurai.sql` 已在正式 D1 生效。微信配置未提供时，站点仍使用浏览器本地身份。
