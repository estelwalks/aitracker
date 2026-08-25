import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Download,
  Image as ImageIcon,
  RefreshCw,
  X,
} from "lucide-react";

import { Segmented, TTButton } from "./tt";
import { useI18n } from "../lib/i18n/context";
import { brandParams, POSTER_FILENAME_PREFIX } from "../lib/app-config";
import type { BoundFormatters } from "../lib/i18n/format";

export type PosterPeriod =
  "today" | "week" | "month" | "year" | "custom" | "7d" | "30d";

export type PosterData = {
  periodLabel: string;
  rangeLabel: string;
  tokens: number;
  costLabel: string;
  savedLabel: string;
  hitRate: number;
  trend: number[];
  providers: { name: string; value: number }[];
  models: { name: string; tokens: string; pct: number }[];
  unknownPriceModels: number;
};

type SkinKey = "dark" | "light";

type TFunction = ReturnType<typeof useI18n>["t"];

const WIDTH = 1080;
const HEIGHT = 1920;
const MONO =
  '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS =
  '"Inter Variable", "Noto Sans SC Variable", "PingFang SC", "Hiragino Sans GB", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans KR", "Microsoft YaHei", system-ui, sans-serif';

const skins = {
  dark: {
    background: ["#091019", "#152335"],
    foreground: "#edf4ff",
    muted: "#91a3b9",
    line: "#293b50",
    accent: "#54a6ff",
    palette: ["#54a6ff", "#3fd7a2", "#f5b455", "#bb91ff"],
    grid: "rgba(255,255,255,0.04)",
  },
  light: {
    background: ["#fbfaf6", "#e9edf4"],
    foreground: "#17202d",
    muted: "#657184",
    line: "#cfd6df",
    accent: "#1769d2",
    palette: ["#1769d2", "#168a67", "#bd6f16", "#7648c7"],
    grid: "rgba(23,32,45,0.04)",
  },
} as const;

function rank(t: TFunction, tokens: number): [string, string] {
  if (tokens >= 20_000_000)
    return [t("dashboard.poster.rank1"), t("dashboard.poster.rank1Desc")];
  if (tokens >= 5_000_000)
    return [t("dashboard.poster.rank2"), t("dashboard.poster.rank2Desc")];
  if (tokens >= 1_000_000)
    return [t("dashboard.poster.rank3"), t("dashboard.poster.rank3Desc")];
  if (tokens >= 200_000)
    return [t("dashboard.poster.rank4"), t("dashboard.poster.rank4Desc")];
  return [t("dashboard.poster.rank5"), t("dashboard.poster.rank5Desc")];
}

function drawPoster(
  canvas: HTMLCanvasElement,
  data: PosterData,
  skinKey: SkinKey,
  t: TFunction,
  format: BoundFormatters,
) {
  const context = canvas.getContext("2d");
  if (context == null) return;
  const skin = skins[skinKey];
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, skin.background[0]);
  background.addColorStop(1, skin.background[1]);
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.strokeStyle = skin.grid;
  context.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 48) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 48) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(WIDTH, y + 0.5);
    context.stroke();
  }

  const margin = 84;
  const [rankName, rankDescription] = rank(t, data.tokens);
  context.textBaseline = "middle";
  context.textAlign = "left";

  context.fillStyle = skin.accent;
  context.fillRect(margin, 104, 10, 36);
  context.fillStyle = skin.foreground;
  const headline = t("dashboard.poster.headline", brandParams);
  context.font = `600 ${fitFontSize(
    context,
    headline,
    WIDTH - margin - 28 - 220,
    31,
  )}px ${SANS}`;
  context.fillText(headline, margin + 28, 122);
  context.textAlign = "right";
  context.fillStyle = skin.muted;
  context.font = `400 22px ${MONO}`;
  context.fillText(data.periodLabel, WIDTH - margin, 122);
  context.textAlign = "left";

  context.fillStyle = skin.muted;
  context.font = `400 24px ${SANS}`;
  context.fillText(data.rangeLabel, margin, 190);
  context.fillText(t("dashboard.poster.rankLabel"), margin, 282);
  context.fillStyle = skin.foreground;
  context.font = `700 ${fitFontSize(
    context,
    rankName,
    WIDTH - margin * 2,
    88,
  )}px ${SANS}`;
  context.fillText(rankName, margin, 366);
  context.fillStyle = skin.muted;
  context.font = `400 27px ${SANS}`;
  context.fillText(rankDescription, margin, 430);

  context.font = `400 23px ${MONO}`;
  context.fillText(t("dashboard.poster.totalTokens"), margin, 535);
  context.fillStyle = skin.accent;
  context.font = `700 112px ${MONO}`;
  context.fillText(format.formatNumber(data.tokens), margin, 630);

  const metrics = [
    [t("dashboard.poster.metricCost"), data.costLabel],
    [t("dashboard.poster.metricSaved"), data.savedLabel],
    [t("dashboard.poster.metricHit"), format.formatPercent(data.hitRate)],
  ];
  const metricY = 735;
  const metricWidth = (WIDTH - margin * 2) / metrics.length;
  context.strokeStyle = skin.line;
  context.lineWidth = 2;
  context.strokeRect(margin, metricY, WIDTH - margin * 2, 164);
  metrics.forEach(([label, value], index) => {
    const x = margin + metricWidth * index;
    if (index > 0) {
      context.beginPath();
      context.moveTo(x, metricY + 24);
      context.lineTo(x, metricY + 140);
      context.stroke();
    }
    context.fillStyle = skin.muted;
    context.font = `400 22px ${SANS}`;
    context.fillText(label, x + 28, metricY + 50);
    context.fillStyle = skin.foreground;
    context.font = `600 34px ${MONO}`;
    fitText(context, value, metricWidth - 56, x + 28, metricY + 111);
  });

  drawTrend(context, data, skin, margin, 1035, t);
  drawProviders(context, data, skin, margin, 1370, t);
  drawModels(context, data, skin, margin, 1570, t);

  context.strokeStyle = skin.line;
  context.beginPath();
  context.moveTo(margin, HEIGHT - 125);
  context.lineTo(WIDTH - margin, HEIGHT - 125);
  context.stroke();
  context.fillStyle = skin.muted;
  context.font = `400 21px ${SANS}`;
  context.fillText(
    data.unknownPriceModels > 0
      ? t("dashboard.poster.unknownPrice", {
          count: data.unknownPriceModels,
        })
      : t("dashboard.poster.allPriced"),
    margin,
    HEIGHT - 79,
  );
  context.textAlign = "right";
  context.fillStyle = skin.accent;
  context.fillText(
    t("dashboard.poster.localOnly"),
    WIDTH - margin,
    HEIGHT - 79,
  );
}

function drawTrend(
  context: CanvasRenderingContext2D,
  data: PosterData,
  skin: (typeof skins)[SkinKey],
  margin: number,
  y: number,
  t: TFunction,
) {
  context.fillStyle = skin.muted;
  context.font = `400 23px ${SANS}`;
  context.fillText(t("dashboard.poster.trend"), margin, y - 38);
  const values = data.trend.length > 0 ? data.trend : [0];
  const maximum = Math.max(...values, 1);
  const gap = 14;
  const width =
    (WIDTH - margin * 2 - gap * (values.length - 1)) / values.length;
  const height = 220;
  values.forEach((value, index) => {
    const barHeight = Math.max(4, (value / maximum) * height);
    const x = margin + index * (width + gap);
    context.fillStyle = skin.line;
    context.fillRect(x, y, width, height);
    context.fillStyle = skin.accent;
    context.fillRect(x, y + height - barHeight, width, barHeight);
  });
}

function drawProviders(
  context: CanvasRenderingContext2D,
  data: PosterData,
  skin: (typeof skins)[SkinKey],
  margin: number,
  y: number,
  t: TFunction,
) {
  context.fillStyle = skin.muted;
  context.font = `400 23px ${SANS}`;
  context.fillText(t("dashboard.poster.providers"), margin, y - 34);
  const total = data.providers.reduce((sum, item) => sum + item.value, 0) || 1;
  let x = margin;
  const width = WIDTH - margin * 2;
  data.providers.forEach((provider, index) => {
    const itemWidth = (provider.value / total) * width;
    context.fillStyle = skin.palette[index % skin.palette.length];
    context.fillRect(x, y, Math.max(2, itemWidth - 4), 28);
    x += itemWidth;
  });
  context.font = `400 21px ${MONO}`;
  let labelX = margin;
  data.providers.slice(0, 4).forEach((provider, index) => {
    context.fillStyle = skin.palette[index % skin.palette.length];
    context.fillRect(labelX, y + 58, 14, 14);
    context.fillStyle = skin.muted;
    const label = `${provider.name} ${Math.round((provider.value / total) * 100)}%`;
    context.fillText(label, labelX + 24, y + 66);
    labelX += 24 + context.measureText(label).width + 40;
  });
}

function drawModels(
  context: CanvasRenderingContext2D,
  data: PosterData,
  skin: (typeof skins)[SkinKey],
  margin: number,
  y: number,
  t: TFunction,
) {
  context.fillStyle = skin.muted;
  context.font = `400 23px ${SANS}`;
  context.fillText(t("dashboard.poster.models"), margin, y - 30);
  data.models.slice(0, 3).forEach((model, index) => {
    const rowY = y + index * 62;
    context.fillStyle = skin.foreground;
    context.font = `400 22px ${MONO}`;
    fitText(context, model.name, 330, margin, rowY);
    context.fillStyle = skin.line;
    context.fillRect(margin + 350, rowY - 8, 390, 16);
    context.fillStyle = skin.palette[index % skin.palette.length];
    context.fillRect(
      margin + 350,
      rowY - 8,
      (390 * Math.max(2, model.pct)) / 100,
      16,
    );
    context.textAlign = "right";
    context.fillStyle = skin.muted;
    context.fillText(model.tokens, WIDTH - margin, rowY);
    context.textAlign = "left";
  });
}

function fitText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  x: number,
  y: number,
) {
  if (context.measureText(value).width <= maxWidth) {
    context.fillText(value, x, y);
    return;
  }
  let shortened = value;
  while (
    shortened.length > 1 &&
    context.measureText(`${shortened}…`).width > maxWidth
  ) {
    shortened = shortened.slice(0, -1);
  }
  context.fillText(`${shortened}…`, x, y);
}

/**
 * Shrink the font size until the text fits `maxWidth` (ja/ko titles are
 * wider than zh; prefer scaling over truncation for headline/rank titles).
 */
function fitFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  basePx: number,
): number {
  let px = basePx;
  while (px > 12 && context.measureText(text).width > maxWidth) px -= 1;
  return px;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
}

export function TokenPoster({
  data,
  filePeriod,
  onClose,
}: {
  data: PosterData;
  filePeriod: PosterPeriod;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [skin, setSkin] = useState<SkinKey>("dark");
  const [message, setMessage] = useState("");

  const render = useCallback(() => {
    if (canvasRef.current != null)
      drawPoster(canvasRef.current, data, skin, t, format);
  }, [data, skin, t, format]);

  useEffect(() => {
    render();
  }, [render]);

  const download = async () => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    const blob = await canvasBlob(canvas);
    if (blob == null) {
      setMessage(t("dashboard.poster.errNoPng"));
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.download = `${POSTER_FILENAME_PREFIX}${filePeriod}-${Date.now()}.png`;
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(t("dashboard.poster.downloaded"));
  };

  const copy = async () => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    if (
      typeof ClipboardItem === "undefined" ||
      navigator.clipboard?.write == null
    ) {
      setMessage(t("dashboard.poster.errNoCopy"));
      return;
    }
    const blob = await canvasBlob(canvas);
    if (blob == null) {
      setMessage(t("dashboard.poster.errNoImage"));
      return;
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setMessage(t("dashboard.poster.copied"));
    } catch {
      setMessage(t("dashboard.poster.errClipboard"));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="tt-panel flex max-h-[94vh] w-full max-w-[920px] flex-col overflow-hidden bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <ImageIcon className="size-4" /> {t("dashboard.poster.generate")}
            <span className="tt-num text-[10px] text-muted-foreground">
              1080 × 1920
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("dashboard.poster.close")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="text-[12px] text-muted-foreground">
            {t("dashboard.poster.range", { period: data.periodLabel })}
            <span className="ml-2">{data.rangeLabel}</span>
          </div>
          <Segmented
            value={skin}
            onChange={setSkin}
            options={[
              { value: "dark", label: t("dashboard.poster.skinDark") },
              { value: "light", label: t("dashboard.poster.skinLight") },
            ]}
          />
        </div>

        <div className="tt-scroll flex-1 overflow-auto bg-background/40 p-4">
          <canvas
            ref={canvasRef}
            className="mx-auto block w-full max-w-[360px] rounded-sm border border-border"
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span role="status" className="text-[11px] text-muted-foreground">
            {message || t("dashboard.poster.disclaimer")}
          </span>
          <div className="flex items-center gap-2">
            <TTButton onClick={render}>
              <RefreshCw className="size-3.5" />{" "}
              {t("dashboard.poster.regenerate")}
            </TTButton>
            <TTButton onClick={copy}>
              <Clipboard className="size-3.5" /> {t("dashboard.poster.copy")}
            </TTButton>
            <TTButton variant="primary" onClick={download}>
              <Download className="size-3.5" /> {t("dashboard.poster.download")}
            </TTButton>
          </div>
        </footer>
      </div>
    </div>
  );
}
