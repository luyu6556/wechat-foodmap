// 成员代表色：全站唯一色板定义，改这里等于改全站。
// 选色口径：亮度 L 集中在 48%–53%（旧板最低只有 31.6%，发闷），
// 且每一色在白字/墨字里至少有一侧达到 WCAG AA 的 4.5:1。
export const MEMBER_COLORS = ["#BE5437", "#39C6B7", "#3970C6", "#A139C6", "#C68A39", "#C63960", "#39C670", "#319CDD"];

export const DEFAULT_MEMBER_COLOR = MEMBER_COLORS[0];

// 旧色板 → 新色板，同色相一一对应。
// 历史成员在库里存的仍是旧值，读取时统一换算，避免新旧两套颜色混搭；
// 写入时一律写新值（改一次昵称/颜色就会自然落成新值）。
const LEGACY_COLOR_MAP: Record<string, string> = {
  "#e75b35": "#BE5437",
  "#2d7a72": "#39C6B7",
  "#4169a8": "#3970C6",
  "#9360a5": "#A139C6",
  "#d58b26": "#C68A39",
  "#c75574": "#C63960",
  "#41604d": "#39C670",
  "#3f5969": "#319CDD",
};

// 与主题 --ink 同值：浅色底上用它当字色。
const INK = "#18302d";
const WHITE = "#ffffff";

export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** 把任意存储值换算成当前色板里的颜色；空值或非法值回落到默认色。 */
export function normalizeColor(value: string | null | undefined): string {
  if (!isHexColor(value)) return DEFAULT_MEMBER_COLOR;
  return LEGACY_COLOR_MAP[value.toLowerCase()] || value;
}

function relativeLuminance(hex: string): number {
  const body = hex.slice(1);
  const channels = [0, 2, 4].map((offset) => parseInt(body.slice(offset, offset + 2), 16) / 255);
  const linear = (channel: number) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = channels.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** 按背景色的相对亮度挑一个读得清的字色（墨或白）。浅色化之后必须用它，否则白字会糊。 */
export function contrastText(background: string | null | undefined): string {
  const surface = normalizeColor(background);
  return contrastRatio(surface, INK) >= contrastRatio(surface, WHITE) ? INK : WHITE;
}

/** 头像/色块统一的样式：背景是代表色，前景是自动挑出的可读字色。 */
export function memberColorStyle(value: string | null | undefined): { background: string; color: string } {
  const background = normalizeColor(value);
  return { background, color: contrastText(background) };
}
