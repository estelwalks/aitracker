/**
 * 工具品牌图标。内置品牌为内联 SVG（跟随 currentColor / 品牌色，避免外链
 * 依赖）：claude / codex 使用 simple-icons（CC0）提供的官方 logo path，其余
 * 为自绘简化图形。新增内置品牌：扩 match() + brandColor + 对应 SVG 分支即可。
 *
 * 图标与配色优先取工具注册表配置（definitions/*.tool.json 的
 * display.icon / display.color，浏览器安全投影），按工具 id 或展示名
 * 匹配；未配置时回退到名称启发式。因此全站同一工具始终使用同一配色。
 *
 * display.icon 除内置 kind 键外还可配置 http(s) logo URL —— 此时渲染为远程
 * <img>（去掉 referrer）。调用方直接把 URL 当作 name 传入时同样生效。
 */

import { PUBLIC_TOOL_MANIFEST } from "../lib/tool-registry/public-manifest.generated.ts";

type Props = { name: string; className?: string; color?: string };

/** 工具 id 或展示名 → 注册表展示配置（icon kind + 品牌色）。 */
const toolDisplayById = new Map(
  PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.id, tool]),
);
const toolDisplayByName = new Map(
  PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.name, tool]),
);

function displayOf(name: string): PublicToolDisplay | undefined {
  return toolDisplayById.get(name) ?? toolDisplayByName.get(name) ?? undefined;
}

type PublicToolDisplay = {
  id: string;
  name: string;
  nameZh: string;
  icon?: string;
  color?: string;
};

function match(name: string) {
  const n = name.toLowerCase();
  if (
    n.includes("claude") ||
    n.includes("sonnet") ||
    n.includes("opus") ||
    n.includes("haiku")
  )
    return "claude";
  if (
    n.includes("codex") ||
    n.startsWith("o5") ||
    n.startsWith("gpt") ||
    n.includes("openai")
  )
    return "codex";
  if (n.includes("cursor")) return "cursor";
  if (n.includes("gemini")) return "gemini";
  if (n.includes("kimi")) return "kimi";
  if (n.includes("deepseek")) return "deepseek";
  if (n.includes("craft")) return "craft";
  if (n.includes("droid")) return "droid";
  if (n.includes("roo")) return "roo";
  if (n.includes("goose")) return "goose";
  if (n.includes("zed")) return "zed";
  return "other";
}

const brandColor: Record<string, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  cursor: "#cfcfcf",
  gemini: "#4285f4",
  kimi: "#7c5cff",
  deepseek: "#4d6bfe",
  craft: "#9570be",
  droid: "currentColor",
  roo: "#f0524d",
  goose: "currentColor",
  zed: "#3b82f6",
  other: "currentColor",
};

/**
 * 官方品牌 logo 静态资源（public/brand-logos/，来自 TokenTracker 的
 * @lobehub/icons 资产）：优先于内置自绘 SVG 使用，让图标显示真实品牌图形。
 * 点亮/未点亮由调用方控制（未安装置灰 grayscale），logo 本身保留品牌原色。
 */
const BRAND_LOGO_BY_NAME: Record<string, string> = {
  antigravity: "/brand-logos/antigravity.svg",
  anythingllm: "/brand-logos/anythingllm.svg",
  "anythingllm desktop": "/brand-logos/anythingllm.svg",
  claude: "/brand-logos/claude-code.svg",
  "claude code": "/brand-logos/claude-code.svg",
  "claude science": "/brand-logos/claude-code.svg",
  codebuddy: "/brand-logos/codebuddy.svg",
  workbuddy: "/brand-logos/codebuddy.svg",
  codex: "/brand-logos/codex.svg",
  "every code": "/brand-logos/codex.svg",
  copilot: "/brand-logos/copilot.svg",
  "github copilot": "/brand-logos/copilot.svg",
  cursor: "/brand-logos/cursor.svg",
  deepseek: "/brand-logos/deepseek.svg",
  "deepseek harness": "/brand-logos/deepseek.svg",
  gemini: "/brand-logos/gemini.svg",
  "gemini cli": "/brand-logos/gemini.svg",
  grok: "/brand-logos/grok.svg",
  "grok build": "/brand-logos/grok.svg",
  hermes: "/brand-logos/hermes.svg",
  "hermes agent": "/brand-logos/hermes.svg",
  kilo: "/brand-logos/kilo.svg",
  "kilo cli": "/brand-logos/kilo.svg",
  "kilo code": "/brand-logos/kilo.svg",
  kimi: "/brand-logos/kimi.svg",
  "kimi code": "/brand-logos/kimi.svg",
  kiro: "/brand-logos/kiro.svg",
  mimo: "/brand-logos/mimo.svg",
  "mimo code": "/brand-logos/mimo.svg",
  "oh-my-pi": "/brand-logos/omp.svg",
  "oh my pi": "/brand-logos/omp.svg",
  omp: "/brand-logos/omp.svg",
  openclaw: "/brand-logos/openclaw.svg",
  opencode: "/brand-logos/opencode.svg",
  pi: "/brand-logos/pi.svg",
  qoder: "/brand-logos/qoder.svg",
  "qoder cn": "/brand-logos/qoder-cn.svg",
  reasonix: "/brand-logos/reasonix.png",
  zcode: "/brand-logos/zcode.svg",
};

function brandLogoSrc(name: string): string | undefined {
  // 同时接受展示名（"Claude Code"）、工具 id（"claude-code"）与 kind 键。
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return BRAND_LOGO_BY_NAME[normalized];
}

/** 各产品品牌原色（顺序优先：第一个命中的规则胜出）。 */
const productColor: { test: (n: string) => boolean; color: string }[] = [
  {
    test: (n) =>
      n.includes("claude") ||
      n.includes("sonnet") ||
      n.includes("opus") ||
      n.includes("haiku"),
    color: "#d97757",
  },
  {
    test: (n) =>
      n.includes("codex") ||
      n.includes("openai") ||
      n.startsWith("gpt") ||
      n.startsWith("o5"),
    color: "#10a37f",
  },
  {
    test: (n) => n.includes("gemini") || n.includes("antigravity"),
    color: "#4285f4",
  },
  { test: (n) => n.includes("cursor"), color: "#cfcfcf" },
  { test: (n) => n.includes("kimi"), color: "#7c5cff" },
  { test: (n) => n.includes("deepseek"), color: "#4d6bfe" },
  { test: (n) => n.includes("windsurf"), color: "#09b6a2" },
  { test: (n) => n.includes("cline"), color: "#5b8def" },
  { test: (n) => n.includes("roo"), color: "#f0524d" },
  { test: (n) => n.includes("aider"), color: "#14b8a6" },
  { test: (n) => n.includes("qwen"), color: "#615ced" },
  { test: (n) => n.includes("opencode"), color: "#f59e0b" },
  { test: (n) => n.includes("grok"), color: "#d1d5db" },
  { test: (n) => n.includes("trae"), color: "#ff4d4f" },
  { test: (n) => n.includes("zed"), color: "#3b82f6" },
];

export function brandColorOf(name: string) {
  const display = displayOf(name);
  if (display?.color) return display.color;
  const n = name.toLowerCase();
  return productColor.find((p) => p.test(n))?.color ?? "currentColor";
}

export function BrandIcon({ name, className = "size-3.5", color }: Props) {
  const display = displayOf(name);
  // display.icon 可以是内置 kind 键，也可以是 http(s) logo URL；调用方也
  // 可能直接把 URL 当 name 传入（如 tool.icon）。二者都走远程 <img> 分支。
  const rawIcon = display?.icon ?? name;
  const kind = display?.icon ?? match(name);
  const fill = color ?? display?.color ?? brandColor[kind];
  const common = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
  };

  // 外链品牌 logo（definitions/*.tool.json 的 display.icon 指向厂商图片）：
  // 渲染为远程 <img>，去掉 referrer，避免把本站地址泄漏给第三方。
  if (/^https?:\/\//i.test(rawIcon)) {
    return (
      <img
        src={rawIcon}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`object-contain ${className}`}
      />
    );
  }

  const localLogoSrc =
    brandLogoSrc(name) ?? (kind === "other" ? undefined : brandLogoSrc(kind));
  if (localLogoSrc != null) {
    return (
      <img
        src={localLogoSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`object-contain ${className}`}
      />
    );
  }

  if (kind === "claude")
    return (
      <svg {...common} fill={fill}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * 180) / 8 + 11.25;
          const r = (a * Math.PI) / 180;
          const w = 1.5;
          return (
            <rect
              key={i}
              x={12 - w / 2}
              y={2}
              width={w}
              height={20}
              rx={w / 2}
              transform={`rotate(${(r * 180) / Math.PI} 12 12)`}
            />
          );
        })}
      </svg>
    );

  if (kind === "codex")
    // OpenAI 官方 logo（chatgpt.com favicon）--Codex / ChatGPT 同属 OpenAI。
    // 按需求使用官方黑白配色：fill=currentColor 跟随容器文字色
    // （浅色主题近黑、深色主题近白），不跟随 display.color 配置。
    return (
      <svg
        className={common.className}
        viewBox="0 0 180 180"
        aria-hidden={common["aria-hidden"]}
        fill="currentColor"
      >
        <path d="M101.228 164.247C96.2776 164.247 91.5751 163.307 87.1201 161.426C82.6651 159.545 78.7051 156.921 75.2401 153.555C71.4781 154.842 67.5676 155.486 63.5086 155.486C56.8756 155.486 50.7376 153.852 45.0946 150.585C39.4516 147.318 34.8976 142.863 31.4326 137.22C28.0666 131.577 26.3836 125.291 26.3836 118.361C26.3836 115.49 26.7796 112.371 27.5716 109.005C23.6116 105.342 20.5426 101.135 18.3646 96.3828C16.1866 91.5318 15.0976 86.4828 15.0976 81.2358C15.0976 75.8898 16.2361 70.7418 18.5131 65.7918C20.7901 60.8418 23.9581 56.5848 28.0171 53.0208C32.1751 49.3578 36.9766 46.8333 42.4216 45.4473C43.5106 39.8043 45.7876 34.7553 49.2526 30.3003C52.8166 25.7463 57.1726 22.1823 62.3206 19.6083C67.4686 17.0343 72.9631 15.7473 78.8041 15.7473C83.7541 15.7473 88.4566 16.6878 92.9116 18.5688C97.3666 20.4498 101.327 23.0733 104.792 26.4393C108.554 25.1523 112.464 24.5088 116.523 24.5088C123.156 24.5088 129.294 26.1423 134.937 29.4093C140.58 32.6763 145.085 37.1313 148.451 42.7743C151.916 48.4173 153.648 54.7038 153.648 61.6338C153.648 64.5048 153.252 67.6233 152.46 70.9893C156.42 74.6523 159.489 78.9093 161.667 83.7603C163.845 88.5123 164.934 93.5118 164.934 98.7588C164.934 104.105 163.796 109.253 161.519 114.203C159.242 119.153 156.024 123.459 151.866 127.122C147.807 130.686 143.055 133.161 137.61 134.547C136.521 140.19 134.195 145.239 130.631 149.694C127.166 154.248 122.859 157.812 117.711 160.386C112.563 162.96 107.069 164.247 101.228 164.247ZM64.5481 145.685C69.4981 145.685 73.8046 144.645 77.4676 142.566L105.386 126.528C106.376 125.835 106.871 124.895 106.871 123.707V110.936L70.9336 131.577C68.7556 132.864 66.5776 132.864 64.3996 131.577L36.3331 115.391C36.3331 115.688 36.2836 116.034 36.1846 116.43C36.1846 116.826 36.1846 117.42 36.1846 118.212C36.1846 123.261 37.3726 127.914 39.7486 132.171C42.2236 136.329 45.6391 139.596 49.9951 141.972C54.3511 144.447 59.2021 145.685 64.5481 145.685ZM66.0331 121.479C66.6271 121.776 67.1716 121.925 67.6666 121.925C68.1616 121.925 68.6566 121.776 69.1516 121.479L80.2891 115.094L44.5006 94.3038C42.3226 93.0168 41.2336 91.0863 41.2336 88.5123V56.2878C36.2836 58.4658 32.3236 61.8318 29.3536 66.3858C26.3836 70.8408 24.8986 75.7908 24.8986 81.2358C24.8986 86.0868 26.1361 90.7398 28.6111 95.1948C31.0861 99.6498 34.3036 103.016 38.2636 105.293L66.0331 121.479ZM101.228 154.446C106.475 154.446 111.227 153.258 115.484 150.882C119.741 148.506 123.107 145.239 125.582 141.081C128.057 136.923 129.294 132.27 129.294 127.122V95.0463C129.294 93.8583 128.799 92.9673 127.809 92.3733L116.523 85.8393V127.271C116.523 129.845 115.434 131.775 113.256 133.062L85.1896 149.249C90.0406 152.714 95.3866 154.446 101.228 154.446ZM106.871 100.095V79.8993L90.09 70.3953L73.1611 79.8993V100.095L90.09 109.599L106.871 100.095ZM63.5086 52.7238C63.5086 50.1498 64.5976 48.2193 66.7756 46.9323L94.8421 30.7458C89.9911 27.2808 84.6451 25.5483 78.8041 25.5483C73.5571 25.5483 68.8051 26.7363 64.5481 29.1123C60.2911 31.4883 56.9251 34.7553 54.4501 38.9133C52.0741 43.0713 50.8861 47.7243 50.8861 52.8723V84.7998C50.8861 85.9878 51.3811 86.9283 52.3711 87.6213L63.5086 94.1553V52.7238ZM138.947 123.707C143.897 121.529 147.807 118.163 150.678 113.609C153.648 109.055 155.133 104.105 155.133 98.7588C155.133 93.9078 153.896 89.2548 151.421 84.7998C148.946 80.3448 145.728 76.9788 141.768 74.7018L113.999 58.6638C113.405 58.2678 112.86 58.1193 112.365 58.2183C111.87 58.2183 111.375 58.3668 110.88 58.6638L99.7426 64.9008L135.68 85.8393C136.769 86.4333 137.561 87.2253 138.056 88.2153C138.65 89.1063 138.947 90.1953 138.947 91.4823V123.707ZM109.098 48.2688C111.276 46.8828 113.454 46.8828 115.632 48.2688L143.847 64.7523C143.847 64.0593 143.847 63.1683 143.847 62.0793C143.847 57.3273 142.659 52.8228 140.283 48.5658C138.006 44.2098 134.69 40.7448 130.334 38.1708C126.077 35.5968 121.127 34.3098 115.484 34.3098C110.534 34.3098 106.227 35.3493 102.564 37.4283L74.6461 53.4663C73.6561 54.1593 73.1611 55.0998 73.1611 56.2878V69.0588L109.098 48.2688Z" />
      </svg>
    );

  if (kind === "cursor")
    return (
      <svg
        {...common}
        fill="none"
        stroke={fill}
        strokeWidth={1.5}
        strokeLinejoin="round"
      >
        <path d="M12 2.2 21 7.2v9.6L12 21.8 3 16.8V7.2z" />
        <path d="M12 12 21 7.2M12 12v9.8M12 12 3 7.2" opacity={0.6} />
      </svg>
    );

  if (kind === "gemini")
    return (
      <svg {...common} fill={fill}>
        <path d="M12 2c.4 5.2 4.4 9.6 10 10-5.6.4-9.6 4.8-10 10-.4-5.2-4.4-9.6-10-10 5.6-.4 9.6-4.8 10-10z" />
      </svg>
    );

  if (kind === "kimi")
    return (
      <svg
        {...common}
        fill="none"
        stroke={fill}
        strokeWidth={1.7}
        strokeLinecap="round"
      >
        <path d="M20 12a8 8 0 1 1-8.6-8 6.4 6.4 0 0 0 8.6 8z" />
      </svg>
    );

  if (kind === "deepseek")
    return (
      <svg
        {...common}
        fill="none"
        stroke={fill}
        strokeWidth={1.6}
        strokeLinecap="round"
      >
        <path d="M3 9c4.5-3 8.5-1 11 1.5S19.5 15 21 13" />
        <circle cx="17.5" cy="7.5" r="1.6" fill={fill} stroke="none" />
      </svg>
    );

  if (kind === "craft")
    return (
      <svg {...common} fill="none">
        <g transform="translate(3.4502, 3)" fill={fill} fillRule="nonzero">
          <path d="M3.17890888,3.6 L3.17890888,0 L16,0 L16,3.6 L3.17890888,3.6 Z M9.642,7.2 L9.64218223,10.8 L0,10.8 L0,3.6 L16,3.6 L16,7.2 L9.642,7.2 Z M3.17890888,18 L3.178,14.4 L0,14.4 L0,10.8 L16,10.8 L16,18 L3.17890888,18 Z" />
        </g>
      </svg>
    );

  if (kind === "droid")
    return (
      <svg
        {...common}
        fill="none"
        stroke={fill}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 3v2" />
        <path d="M15 3v2" />
        <rect x="4" y="6" width="16" height="13" rx="3" />
        <circle cx="9" cy="13" r="1.4" fill={fill} stroke="none" />
        <circle cx="15" cy="13" r="1.4" fill={fill} stroke="none" />
        <path d="M9 16h6" />
      </svg>
    );

  if (kind === "roo")
    return (
      <svg {...common} fill={fill} fillRule="evenodd">
        <path d="M20.113 5.5l-.442 1.557a.157.157 0 01-.196.106l-7.414-2.157a.16.16 0 00-.143.028l-7.342 5.74a.159.159 0 01-.074.032l-4.37.656a.154.154 0 00-.132.162l.02.245c.005.078.071.14.152.141l5.074.128.058.002 3.75-1.953a.16.16 0 01.164.01l2.657 1.847a.152.152 0 01.066.125l-.023 2.45c0 .032.01.063.028.089l3.737 5.227c.03.04.077.065.129.065h1.182a.153.153 0 00.14-.224l-2.664-4.919a.15.15 0 01.005-.152l1.389-2.169a.156.156 0 01.062-.055l4.965-2.456a.16.16 0 01.158.01l1.418.921a.16.16 0 00.087.026h1.289c.125 0 .2-.136.13-.237l-3.578-5.29c-.074-.109-.246-.082-.282.044z" />
      </svg>
    );

  if (kind === "goose")
    return (
      <svg {...common} fill={fill} fillRule="evenodd">
        <path d="M21.595 23.61c1.167-.254 2.405-.944 2.405-.944l-2.167-1.784a12.124 12.124 0 01-2.695-3.131 12.127 12.127 0 00-3.97-4.049l-.794-.462a1.115 1.115 0 01-.488-.815.844.844 0 01.154-.575c.413-.582 2.548-3.115 2.94-3.44.503-.416 1.065-.762 1.586-1.159.074-.056.148-.112.221-.17.003-.002.007-.004.009-.007.167-.131.325-.272.45-.438.453-.524.563-.988.59-1.193-.061-.197-.244-.639-.753-1.148.319.02.705.272 1.056.569.235-.376.481-.773.727-1.171.165-.266-.08-.465-.086-.471h-.001V3.22c-.007-.007-.206-.25-.471-.086-.567.35-1.134.702-1.639 1.021 0 0-.597-.012-1.305.599a2.464 2.464 0 00-.438.45l-.007.009c-.058.072-.114.147-.17.221-.397.521-.743 1.083-1.16 1.587-.323.391-2.857 2.526-3.44 2.94a.842.842 0 01-.574.153 1.115 1.115 0 01-.815-.488l-.462-.794a12.123 12.123 0 00-4.049-3.97 12.133 12.133 0 01-3.13-2.695L1.332 0S.643 1.238.39 2.405c.352.428 1.27 1.49 2.34 2.302C1.58 4.167.73 3.75.06 3.4c-.103.765-.063 1.92.043 2.816.726.317 1.961.806 3.219 1.066-1.006.236-2.11.278-2.961.262.15.554.358 1.119.64 1.688.119.263.25.52.39.77.452.125 2.222.383 3.164.171l-2.51.897a27.776 27.776 0 002.544 2.726c2.031-1.092 2.494-1.241 4.018-2.238-2.467 2.008-3.108 2.828-3.8 3.67l-.483.678c-.25.351-.469.725-.65 1.117-.61 1.31-1.47 4.1-1.47 4.1-.154.486.202.842.674.674 0 0 2.79-.861 4.1-1.47.392-.182.766-.4 1.118-.65l.677-.483c.227-.187.453-.37.701-.586 0 0 1.705 2.02 3.458 3.349l.896-2.511c-.211.942.046 2.712.17 3.163.252.142.509.272.772.392.569.28 1.134.49 1.688.64-.016-.853.026-1.956.261-2.962.26 1.258.75 2.493 1.067 3.219.895.106 2.051.146 2.816.043a73.87 73.87 0 01-1.308-2.67c.811 1.07 1.874 1.988 2.302 2.34h-.001z" />
      </svg>
    );

  if (kind === "zed")
    return (
      <svg
        className={common.className}
        viewBox="0 0 16 16"
        aria-hidden={common["aria-hidden"]}
        fill={fill}
        fillRule="evenodd"
      >
        <path d="M3.125 2.75C2.9179 2.75 2.75 2.9179 2.75 3.125V11.375H2V3.125C2 2.50368 2.50368 2 3.125 2H13.1723C13.6735 2 13.9244 2.6059 13.5701 2.96025L7.38189 9.14843H9.125V8.375H9.875V9.33593C9.875 9.6466 9.6232 9.8984 9.3125 9.8984H6.63189L5.34282 11.1875H11.1875V6.5H11.9375V11.1875C11.9375 11.6017 11.6017 11.9375 11.1875 11.9375H4.59282L3.28032 13.25H12.875C13.0821 13.25 13.25 13.0821 13.25 12.875V4.625H14V12.875C14 13.4963 13.4963 14 12.875 14H2.82767C2.32653 14 2.07557 13.3941 2.42992 13.0397L8.59468 6.875H6.875V7.625H6.125V6.6875C6.125 6.37684 6.37684 6.125 6.6875 6.125H9.34468L10.6571 4.8125H4.8125V9.5H4.0625V4.8125C4.0625 4.39829 4.39829 4.0625 4.8125 4.0625H11.4071L12.7197 2.75H3.125Z" />
      </svg>
    );

  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M7.5 12h9" opacity={0.5} />
    </svg>
  );
}
