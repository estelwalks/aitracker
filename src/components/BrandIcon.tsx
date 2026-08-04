/**
 * 工具品牌图标（内联 SVG，跟随 currentColor / 品牌色，避免外链依赖）。
 * claude / codex 使用 simple-icons（CC0）提供的官方 logo path；其余为
 * 自绘简化图形。新增品牌：扩 match() + brandColor + 对应 SVG 分支即可。
 */

type Props = { name: string; className?: string; color?: string };

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
  return "other";
}

const brandColor: Record<string, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  cursor: "#8b8b8b",
  gemini: "#4285f4",
  kimi: "#7c5cff",
  deepseek: "#4d6bfe",
  other: "currentColor",
};

export function brandColorOf(name: string) {
  return brandColor[match(name)];
}

export function BrandIcon({ name, className = "size-3.5", color }: Props) {
  const kind = match(name);
  const fill = color ?? brandColor[kind];
  const common = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
  };

  if (kind === "claude")
    // Anthropic 官方 logo（simple-icons，CC0）
    return (
      <svg {...common} fill={fill}>
        <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
      </svg>
    );

  if (kind === "codex")
    // OpenAI 官方 logo（simple-icons，CC0）--Codex / ChatGPT 同属 OpenAI
    return (
      <svg {...common} fill={fill}>
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
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

  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M7.5 12h9" opacity={0.5} />
    </svg>
  );
}
