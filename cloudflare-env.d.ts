declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OWNER_CLAIM_CODE_HASH?: string;
    AMAP_WEB_KEY?: string;
    AMAP_SECURITY_JS_CODE?: string;
    WECHAT_APP_ID?: string;
    WECHAT_APP_SECRET?: string;
    PUBLIC_SITE_URL?: string;
    // 截图识别（智谱开放平台）。密钥只写在本机 .dev.vars，不进仓库、不下发到浏览器。
    ZHIPU_API_KEY?: string;
    ZHIPU_VISION_MODEL?: string;
    // 自动定位用的百度地图「服务端」AK。与浏览器端 AK 不是一回事。
    BAIDU_MAP_AK?: string;
    // 截图推断不出城市时的兜底城市，用于定位时的 region 参数。
    DEFAULT_CITY?: string;
  }
}
