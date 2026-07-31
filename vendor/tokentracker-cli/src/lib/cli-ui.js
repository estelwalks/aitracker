const readline = require("node:readline");

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const UNDERLINE = "\x1b[4m";

const SPINNER_FRAMES = ["|", "/", "-", "\\"];

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function formatLine(line, width) {
  if (!width) return line;
  const raw = String(line || "");
  const pad = Math.max(0, width - raw.length);
  return raw + " ".repeat(pad);
}

function renderBox(lines, { padding = 1 } = {}) {
  const content = lines.map((line) => String(line || ""));
  const maxLen = content.reduce((max, line) => Math.max(max, line.length), 0);
  const innerWidth = maxLen + padding * 2;
  const top = `+${"-".repeat(innerWidth)}+`;
  const bottom = `+${"-".repeat(innerWidth)}+`;
  const body = content.map((line) => {
    const padded = " ".repeat(padding) + formatLine(line, maxLen) + " ".repeat(padding);
    return `|${padded}|`;
  });
  return [top, ...body, bottom].join("\n");
}

function color(text, token) {
  return `${token}${text}${RESET}`;
}

function underline(text) {
  return `${UNDERLINE}${text}${RESET}`;
}

async function promptEnter(message) {
  if (!isInteractive()) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(message, () => resolve()));
  rl.close();
}

async function promptMenu({ message, options, defaultIndex = 0 }) {
  if (!isInteractive()) return options[defaultIndex] || options[0];

  const safeOptions = Array.isArray(options) ? options : [];
  if (safeOptions.length === 0) return "";

  const maxIndex = safeOptions.length - 1;
  let currentIndex = Math.min(Math.max(defaultIndex, 0), maxIndex);
  const promptMessage = `${message} (Use Up/Down arrows, Enter)`;
  const linesCount = safeOptions.length + 1;

  const renderLines = () => {
    const lines = [promptMessage];
    safeOptions.forEach((opt, idx) => {
      const prefix = idx === currentIndex ? ">" : " ";
      lines.push(`${prefix} ${opt}`);
    });
    process.stdout.write(lines.join("\n"));
  };

  const rerender = () => {
    for (let i = 0; i < linesCount; i += 1) {
      process.stdout.write("\x1b[2K");
      if (i < linesCount - 1) process.stdout.write("\x1b[1A");
    }
    process.stdout.write("\r");
    renderLines();
  };

  renderLines();

  return await new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        return resolve(safeOptions[currentIndex]);
      }
      if (key.name === "up" || str === "k") {
        currentIndex = currentIndex === 0 ? maxIndex : currentIndex - 1;
        rerender();
        return;
      }
      if (key.name === "down" || str === "j") {
        currentIndex = currentIndex === maxIndex ? 0 : currentIndex + 1;
        rerender();
        return;
      }
      if (key.name === "return") {
        cleanup();
        return resolve(safeOptions[currentIndex]);
      }
      if (str && /^[1-9]$/.test(str)) {
        const idx = Number.parseInt(str, 10) - 1;
        if (idx >= 0 && idx <= maxIndex) {
          currentIndex = idx;
          cleanup();
          return resolve(safeOptions[currentIndex]);
        }
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);
  });
}

function createSpinner({ text, intervalMs = 80 }) {
  let frame = 0;
  let timer = null;

  function start() {
    if (!isInteractive()) {
      process.stdout.write(`${text}\n`);
      return;
    }
    timer = setInterval(() => {
      const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
      frame += 1;
      process.stdout.write(`\r${glyph} ${text}`);
    }, intervalMs);
  }

  function stop(successText) {
    if (timer) clearInterval(timer);
    if (isInteractive()) {
      process.stdout.write(`\r${" ".repeat(text.length + 4)}\r`);
    }
    if (successText) process.stdout.write(`${successText}\n`);
  }

  return { start, stop };
}

function formatSummaryLine({ label, status, detail }) {
  const isSuccess = status === "updated" || status === "set" || status === "installed";
  const bullet = isSuccess ? color("*", GREEN) : "o";
  const statusLabel = isSuccess ? detail || status : detail ? `Skipped - ${detail}` : "Skipped";
  const line = `  ${bullet} ${label.padEnd(22)} [${statusLabel}]`;
  return isSuccess ? line : color(line, DIM);
}

module.exports = {
  BOLD,
  DIM,
  CYAN,
  GREEN,
  YELLOW,
  BLUE,
  RESET,
  color,
  underline,
  renderBox,
  isInteractive,
  promptMenu,
  promptEnter,
  createSpinner,
  formatSummaryLine,
};
