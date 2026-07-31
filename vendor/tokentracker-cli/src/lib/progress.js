function createProgress({ stream } = {}) {
  const out = stream || process.stdout;
  const enabled = Boolean(out && out.isTTY);
  const frames = ["|", "/", "-", "\\"];
  const intervalMs = 90;

  let timer = null;
  let text = "";
  let frame = 0;
  let lastLen = 0;

  function render() {
    if (!enabled) return;
    const line = `${frames[frame++ % frames.length]} ${text}`;
    const pad = lastLen > line.length ? " ".repeat(lastLen - line.length) : "";
    lastLen = line.length;
    out.write(`\r${line}${pad}`);
  }

  function start(initialText) {
    if (!enabled) return;
    text = initialText || "";
    if (timer) clearInterval(timer);
    timer = setInterval(render, intervalMs);
    render();
  }

  function update(nextText) {
    text = nextText || "";
    render();
  }

  function stop() {
    if (!enabled) return;
    if (timer) clearInterval(timer);
    timer = null;
    out.write(`\r${" ".repeat(lastLen)}\r`);
    lastLen = 0;
  }

  return { enabled, start, update, stop };
}

function renderBar(progress, width = 20) {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const filled = Math.round(p * width);
  const empty = Math.max(0, width - filled);
  return `[${"=".repeat(filled)}${"-".repeat(empty)}] ${Math.round(p * 100)}%`;
}

function formatNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return Math.trunc(v).toLocaleString("en-US");
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? String(Math.trunc(v)) : v.toFixed(v >= 10 ? 1 : 2);
  return `${fixed} ${units[i]}`;
}

module.exports = {
  createProgress,
  renderBar,
  formatNumber,
  formatBytes,
};
