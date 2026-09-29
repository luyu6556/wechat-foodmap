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
  }
}
