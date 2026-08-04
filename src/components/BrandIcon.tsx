/** 工具品牌图标（内联 SVG，跟随 currentColor / 品牌色，避免外链依赖） */

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
    return (
      <svg
        {...common}
        fill="none"
        stroke={fill}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 7.5 5 12l4 4.5" />
        <path d="m15 7.5 4 4.5-4 4.5" />
        <circle cx="12" cy="12" r="10.2" strokeWidth={1.2} opacity={0.45} />
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
