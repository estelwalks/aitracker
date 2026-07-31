import { useCallback, useEffect, useRef, useState } from "react";
import { Clipboard, Download, Image as ImageIcon, RefreshCw, X } from "lucide-react";

import { Segmented, TTButton } from "./tt";

export type PosterPeriod = "today" | "week" | "month" | "year" | "custom" | "7d" | "30d";

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

const WIDTH = 1080;
const HEIGHT = 1920;
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

const skins = {
  dark: {
    label: "暗色",
    background: ["#091019", "#152335"],
    foreground: "#edf4ff",
    muted: "#91a3b9",
    line: "#293b50",
    accent: "#54a6ff",
    palette: ["#54a6ff", "#3fd7a2", "#f5b455", "#bb91ff"],
    grid: "rgba(255,255,255,0.04)",
  },
  light: {
    label: "亮色",
    background: ["#fbfaf6", "#e9edf4"],
    foreground: "#17202d",
    muted: "#657184",
    line: "#cfd6df",
    accent: "#1769d2",
    palette: ["#1769d2", "#168a67", "#bd6f16", "#7648c7"],
    grid: "rgba(23,32,45,0.04)",
  },
} as const;

function rank(tokens: number) {
  if (tokens >= 20_000_000) return ["Token 焚烧炉", "算力在你手里没有明天"];
  if (tokens >= 5_000_000) return ["重度炼丹师", "上下文管够，思路不停"];
  if (tokens >= 1_000_000) return ["百万级玩家", "已进入 AI 深水区"];
  if (tokens >= 200_000) return ["稳健通勤者", "该用的时候一点不含糊"];
  return ["克制主义者", "每一个 Token 都花在刀刃上"];
}

function drawPoster(canvas: HTMLCanvasElement, data: PosterData, skinKey: SkinKey) {
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
  const [rankName, rankDescription] = rank(data.tokens);
  context.textBaseline = "middle";
  context.textAlign = "left";

  context.fillStyle = skin.accent;
  context.fillRect(margin, 104, 10, 36);
  context.fillStyle = skin.foreground;
  context.font = `600 31px ${SANS}`;
  context.fillText("AITracker Token 战报", margin + 28, 122);
  context.textAlign = "right";
  context.fillStyle = skin.muted;
  context.font = `400 22px ${MONO}`;
  context.fillText(data.periodLabel, WIDTH - margin, 122);
  context.textAlign = "left";

  context.fillStyle = skin.muted;
  context.font = `400 24px ${SANS}`;
  context.fillText(data.rangeLabel, margin, 190);
  context.fillText("本期称号", margin, 282);
  context.fillStyle = skin.foreground;
  context.font = `700 88px ${SANS}`;
  context.fillText(rankName, margin, 366);
  context.fillStyle = skin.muted;
  context.font = `400 27px ${SANS}`;
  context.fillText(rankDescription, margin, 430);

  context.font = `400 23px ${MONO}`;
  context.fillText("总 Token", margin, 535);
  context.fillStyle = skin.accent;
  context.font = `700 112px ${MONO}`;
  context.fillText(data.tokens.toLocaleString(), margin, 630);

  const metrics = [
    ["估算费用", data.costLabel],
    ["缓存节省", data.savedLabel],
    ["缓存命中", `${data.hitRate.toFixed(1)}%`],
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

  drawTrend(context, data, skin, margin, 1035);
  drawProviders(context, data, skin, margin, 1370);
  drawModels(context, data, skin, margin, 1570);

  context.strokeStyle = skin.line;
  context.beginPath();
  context.moveTo(margin, HEIGHT - 125);
  context.lineTo(WIDTH - margin, HEIGHT - 125);
  context.stroke();
  context.fillStyle = skin.muted;
  context.font = `400 21px ${SANS}`;
  context.fillText(
    data.unknownPriceModels > 0
      ? `其中 ${data.unknownPriceModels} 个模型价格未知 · 费用为已知小计`
      : "全部模型价格可识别 · 费用为公开价估算",
    margin,
    HEIGHT - 79,
  );
  context.textAlign = "right";
  context.fillStyle = skin.accent;
  context.fillText("本地统计 · 数据不出机", WIDTH - margin, HEIGHT - 79);
}

function drawTrend(
  context: CanvasRenderingContext2D,
  data: PosterData,
  skin: (typeof skins)[SkinKey],
  margin: number,
  y: number,
) {
  context.fillStyle = skin.muted;
  context.font = `400 23px ${SANS}`;
  context.fillText("Token 趋势", margin, y - 38);
  const values = data.trend.length > 0 ? data.trend : [0];
  const maximum = Math.max(...values, 1);
  const gap = 14;
  const width = (WIDTH - margin * 2 - gap * (values.length - 1)) / values.length;
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
) {
  context.fillStyle = skin.muted;
  context.font = `400 23px ${SANS}`;
  context.fillText("来源占比", margin, y - 34);
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
) {
  context.fillStyle = skin.muted;
  context.font = `400 23px ${SANS}`;
  context.fillText("主要模型", margin, y - 30);
  data.models.slice(0, 3).forEach((model, index) => {
    const rowY = y + index * 62;
    context.fillStyle = skin.foreground;
    context.font = `400 22px ${MONO}`;
    fitText(context, model.name, 330, margin, rowY);
    context.fillStyle = skin.line;
    context.fillRect(margin + 350, rowY - 8, 390, 16);
    context.fillStyle = skin.palette[index % skin.palette.length];
    context.fillRect(margin + 350, rowY - 8, (390 * Math.max(2, model.pct)) / 100, 16);
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
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  context.fillText(`${shortened}…`, x, y);
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [skin, setSkin] = useState<SkinKey>("dark");
  const [message, setMessage] = useState("");

  const render = useCallback(() => {
    if (canvasRef.current != null) drawPoster(canvasRef.current, data, skin);
  }, [data, skin]);

  useEffect(() => {
    render();
  }, [render]);

  const download = async () => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    const blob = await canvasBlob(canvas);
    if (blob == null) {
      setMessage("当前浏览器无法生成 PNG，请更换浏览器后重试。");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.download = `trusttools-token-${filePeriod}-${Date.now()}.png`;
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("PNG 已下载。");
  };

  const copy = async () => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    if (typeof ClipboardItem === "undefined" || navigator.clipboard?.write == null) {
      setMessage("当前浏览器不支持复制图片，请使用“下载 PNG”。");
      return;
    }
    const blob = await canvasBlob(canvas);
    if (blob == null) {
      setMessage("当前浏览器无法生成图片，请使用“下载 PNG”。");
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMessage("图片已复制到剪贴板。");
    } catch {
      setMessage("浏览器拒绝剪贴板访问，请授权后重试或下载 PNG。");
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
            <ImageIcon className="size-4" /> 生成 Token 海报
            <span className="tt-num text-[10px] text-muted-foreground">1080 × 1920</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="text-[12px] text-muted-foreground">
            当前区间：<span className="tt-num">{data.periodLabel}</span>
            <span className="ml-2">{data.rangeLabel}</span>
          </div>
          <Segmented
            value={skin}
            onChange={setSkin}
            options={[
              { value: "dark", label: "暗色" },
              { value: "light", label: "亮色" },
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
            {message || "费用按公开模型价格估算，不等同于账单。"}
          </span>
          <div className="flex items-center gap-2">
            <TTButton onClick={render}>
              <RefreshCw className="size-3.5" /> 重新生成
            </TTButton>
            <TTButton onClick={copy}>
              <Clipboard className="size-3.5" /> 复制图片
            </TTButton>
            <TTButton variant="primary" onClick={download}>
              <Download className="size-3.5" /> 下载 PNG
            </TTButton>
          </div>
        </footer>
      </div>
    </div>
  );
}
