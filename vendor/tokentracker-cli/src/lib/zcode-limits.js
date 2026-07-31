const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_BILLING_BASE_URL = "https://zcode.z.ai/api/v1/zcode-plan";
const DEFAULT_ZAI_MONITOR_BASE_URL = "https://api.z.ai";
const DEFAULT_BIGMODEL_MONITOR_BASE_URL = "https://bigmodel.cn";
const ZCODE_MONITOR_QUOTA_PATH = "/api/monitor/usage/quota/limit";
const DEFAULT_ZCODE_APP_VERSION = "3.2.5";
const DEFAULT_ZCODE_LOG_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function resolveZcodeHome({ home, env = process.env } = {}) {
  if (typeof env.TOKENTRACKER_ZCODE_HOME === "string" && env.TOKENTRACKER_ZCODE_HOME.trim()) {
    return path.resolve(env.TOKENTRACKER_ZCODE_HOME.trim());
  }
  if (typeof env.ZCODE_HOME === "string" && env.ZCODE_HOME.trim()) {
    return path.resolve(env.ZCODE_HOME.trim());
  }
  return path.join(home || os.homedir(), ".zcode");
}

function resolveZcodeBillingBaseUrl(env = process.env) {
  const explicit =
    typeof env.TOKENTRACKER_ZCODE_BILLING_BASE_URL === "string"
      ? env.TOKENTRACKER_ZCODE_BILLING_BASE_URL.trim()
      : "";
  if (explicit) return explicit.replace(/\/$/, "");
  return DEFAULT_BILLING_BASE_URL;
}

function parsePositiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readZcodeAppVersionFromPlist(plistPath) {
  try {
    if (!fs.existsSync(plistPath)) return null;
    const text = fs.readFileSync(plistPath, "utf8");
    const keyIndex = text.indexOf("<key>CFBundleShortVersionString</key>");
    if (keyIndex < 0) return null;
    const match = text.slice(keyIndex).match(/<string>([^<]+)<\/string>/);
    const version = typeof match?.[1] === "string" ? match[1].trim() : "";
    return version || null;
  } catch (_error) {
    return null;
  }
}

function resolveZcodeAppVersion({ home, env = process.env } = {}) {
  const explicit =
    typeof env.TOKENTRACKER_ZCODE_APP_VERSION === "string"
      ? env.TOKENTRACKER_ZCODE_APP_VERSION.trim()
      : "";
  if (explicit) return explicit;

  const appPath =
    typeof env.TOKENTRACKER_ZCODE_APP_PATH === "string" && env.TOKENTRACKER_ZCODE_APP_PATH.trim()
      ? env.TOKENTRACKER_ZCODE_APP_PATH.trim()
      : null;
  const candidates = appPath
    ? [path.join(appPath, "Contents", "Info.plist")]
    : [
        "/Applications/ZCode.app/Contents/Info.plist",
        path.join(home || os.homedir(), "Applications", "ZCode.app", "Contents", "Info.plist"),
      ];
  for (const plistPath of candidates) {
    const version = readZcodeAppVersionFromPlist(plistPath);
    if (version) return version;
  }
  // The API currently rejects balance requests without app_version. The value is
  // not used for local accounting, so keep a conservative fallback for CLI-only installs.
  return DEFAULT_ZCODE_APP_VERSION;
}

function isZcodeInstalled({ home, env } = {}) {
  const zcodeHome = resolveZcodeHome({ home, env });
  const configPath = path.join(zcodeHome, "v2", "config.json");
  if (fs.existsSync(configPath)) return true;
  const dbPath = path.join(zcodeHome, "cli", "db", "db.sqlite");
  return fs.existsSync(dbPath);
}

function loadZcodeProviderAvailability({ home, env } = {}) {
  const zcodeHome = resolveZcodeHome({ home, env });
  const cachePath = path.join(zcodeHome, "v2", "coding-plan-cache.json");
  if (!fs.existsSync(cachePath)) return {};
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const items = cache?.entryStatus?.items;
    return items && typeof items === "object" ? items : {};
  } catch (_error) {
    return {};
  }
}

function loadZcodeSelectedPlanProviderKeys({ home, env } = {}) {
  const zcodeHome = resolveZcodeHome({ home, env });
  const settingPath = path.join(zcodeHome, "v2", "setting.json");
  if (!fs.existsSync(settingPath)) return [];
  try {
    const setting = JSON.parse(fs.readFileSync(settingPath, "utf8"));
    const selected = setting?.modelProviderFamilySelectedKeys;
    if (!selected || typeof selected !== "object") return [];
    const domain = typeof setting?.providerFamilyDomain === "string" ? setting.providerFamilyDomain : "";
    const domains = [domain, ...Object.keys(selected)].filter(Boolean);
    const out = [];
    for (const key of domains) {
      const raw = typeof selected[key] === "string" ? selected[key].trim() : "";
      const match = raw.match(/builtin:(?:bigmodel|zai)-(?:start|coding)-plan/);
      if (match && !out.includes(match[0])) out.push(match[0]);
    }
    return out;
  } catch (_error) {
    return [];
  }
}

function resolveZcodeCredentialsPath({ home, env } = {}) {
  return path.join(resolveZcodeHome({ home, env }), "v2", "credentials.json");
}

function createZcodeCredentialSecret({ home, env = process.env } = {}) {
  if (typeof env.ZCODE_CREDENTIAL_SECRET === "string" && env.ZCODE_CREDENTIAL_SECRET) {
    return env.ZCODE_CREDENTIAL_SECRET;
  }
  let username = "";
  try {
    username = os.userInfo().username || "";
  } catch (_error) {
    username = "";
  }
  return `zcode-credential-fallback:${process.platform}:${home || os.homedir()}:${username}`;
}

function decryptZcodeCredentialValue(value, { home, env } = {}) {
  if (typeof value !== "string") return null;
  if (!value.startsWith("enc:v1:")) return value;
  const encoded = value.slice("enc:v1:".length);
  const parts = encoded.split(".");
  if (parts.length !== 3) return null;
  try {
    const [ivPart, tagPart, encryptedPart] = parts;
    const iv = Buffer.from(ivPart, "base64url");
    const encrypted = Buffer.from(encryptedPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const key = crypto.createHash("sha256").update(createZcodeCredentialSecret({ home, env })).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (_error) {
    return null;
  }
}

function loadZcodeCredentials({ home, env } = {}) {
  const credentialsPath = resolveZcodeCredentialsPath({ home, env });
  if (!fs.existsSync(credentialsPath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch (_error) {
    return {};
  }
}

function loadZcodeCredential(name, { home, env } = {}) {
  const credentials = loadZcodeCredentials({ home, env });
  const decrypted = decryptZcodeCredentialValue(credentials?.[name], { home, env });
  return typeof decrypted === "string" && decrypted.trim() ? decrypted.trim() : "";
}

function loadZcodeActiveProvider({ home, env } = {}) {
  return loadZcodeCredential("oauth:active_provider", { home, env });
}

function resolveZcodeCredentialAuth(providerKey, { home, env } = {}) {
  const activeProvider = loadZcodeActiveProvider({ home, env });
  if (
    (providerKey === "builtin:zai-start-plan" && activeProvider === "zai") ||
    (providerKey === "builtin:bigmodel-start-plan" && activeProvider === "bigmodel")
  ) {
    return loadZcodeCredential("zcodejwttoken", { home, env });
  }
  return "";
}

function isZcodeBuiltinPlanProvider(providerKey) {
  return /^builtin:(bigmodel|zai)-(start|coding)-plan$/.test(providerKey);
}

function isZcodeCodingPlanProvider(providerKey) {
  return /^builtin:(bigmodel|zai)-coding-plan$/.test(providerKey);
}

function isZcodeStartPlanProvider(providerKey) {
  return /^builtin:(bigmodel|zai)-start-plan$/.test(providerKey);
}

function readEnvString(env, names) {
  for (const name of names) {
    const value = typeof env?.[name] === "string" ? env[name].trim() : "";
    if (value) return value;
  }
  return "";
}

function resolveZcodeProviderBillingBaseUrl(providerKey, provider, env = process.env) {
  const explicit = resolveZcodeBillingBaseUrl(env);
  if (explicit !== DEFAULT_BILLING_BASE_URL) return explicit;
  if (isZcodeStartPlanProvider(providerKey)) return DEFAULT_BILLING_BASE_URL;
  const baseUrl = typeof provider?.options?.baseURL === "string" ? provider.options.baseURL.trim() : "";
  if (/\/zcode-plan\/anthropic\/?$/i.test(baseUrl)) return baseUrl.replace(/\/anthropic\/?$/i, "");
  return null;
}

function normalizeUrlOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin.replace(/\/$/, "");
  } catch (_error) {
    return null;
  }
}

function resolveZcodeProviderQuotaUrl(providerKey, provider, env = process.env) {
  if (!isZcodeCodingPlanProvider(providerKey)) return null;
  const explicit = readEnvString(env, ["TOKENTRACKER_ZCODE_MONITOR_QUOTA_URL"]);
  if (explicit) return explicit;

  const baseUrl = typeof provider?.options?.baseURL === "string" ? provider.options.baseURL.trim() : "";
  const baseOrigin = normalizeUrlOrigin(baseUrl);
  const isZai = providerKey === "builtin:zai-coding-plan";
  const origin = isZai
    ? readEnvString(env, [
        "TOKENTRACKER_ZCODE_ZAI_MONITOR_BASE_URL",
        "ZAI_BUSINESS_BASE_URL",
        "ZAI_PRODUCTION_BUSINESS_BASE_URL",
      ]) || (baseOrigin && /(^|\.)api\.z\.ai$/i.test(new URL(baseOrigin).hostname) ? baseOrigin : DEFAULT_ZAI_MONITOR_BASE_URL)
    : readEnvString(env, [
        "TOKENTRACKER_ZCODE_BIGMODEL_MONITOR_BASE_URL",
        "BIGMODEL_API_BASE_URL",
        "BIGMODEL_PRODUCTION_API_BASE_URL",
      ]) || DEFAULT_BIGMODEL_MONITOR_BASE_URL;
  return `${origin.replace(/\/$/, "")}${ZCODE_MONITOR_QUOTA_PATH}`;
}

function loadZcodeAuthCandidates({ home, env } = {}) {
  const zcodeHome = resolveZcodeHome({ home, env });
  const configPath = path.join(zcodeHome, "v2", "config.json");
  if (!fs.existsSync(configPath)) return [];
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config || typeof config !== "object") return [];
    const providers = config.provider || {};
    const defaultCandidates = [
      "builtin:bigmodel-start-plan",
      "builtin:zai-start-plan",
      "builtin:bigmodel-coding-plan",
      "builtin:zai-coding-plan",
    ];
    const availability = loadZcodeProviderAvailability({ home, env });
    const hasAvailability = Object.keys(availability).length > 0;
    const selectedCandidates = loadZcodeSelectedPlanProviderKeys({ home, env })
      .filter((key) => defaultCandidates.includes(key));
    const availableCandidates = defaultCandidates.filter((key) => availability?.[key]?.status === "available");
    const candidates = [
      ...selectedCandidates,
      ...availableCandidates,
      ...defaultCandidates,
    ].filter((key, index, all) => all.indexOf(key) === index);
    const auths = [];
    for (const key of candidates) {
      const provider = providers[key];
      if (!provider || typeof provider !== "object") continue;
      if (provider.enabled === false) continue;
      if (hasAvailability && availability?.[key]?.status && availability[key].status !== "available") continue;
      const apiKey = typeof provider?.options?.apiKey === "string" ? provider.options.apiKey.trim() : "";
      const billingBaseUrl = resolveZcodeProviderBillingBaseUrl(key, provider, env);
      const quotaUrl = resolveZcodeProviderQuotaUrl(key, provider, env);
      const credentialApiKey = resolveZcodeCredentialAuth(key, { home, env });
      const authEntries = [
        credentialApiKey ? { apiKey: credentialApiKey, authSource: "credential:zcodejwttoken" } : null,
        apiKey ? { apiKey, authSource: "provider:config" } : null,
      ].filter(Boolean);
      const seenKeys = new Set();
      for (const entry of authEntries) {
        if ((!billingBaseUrl && !quotaUrl) || seenKeys.has(entry.apiKey)) continue;
        seenKeys.add(entry.apiKey);
        auths.push({
          apiKey: entry.apiKey,
          auth_source: entry.authSource,
          providerKey: key,
          planKind: isZcodeCodingPlanProvider(key) ? "coding-plan" : "start-plan",
          baseUrl: provider?.options?.baseURL || null,
          billingBaseUrl,
          quotaUrl,
          availability: availability?.[key]?.status || null,
        });
      }
    }
    return auths;
  } catch (_error) {
    return [];
  }
}

function loadZcodeApiKey({ home, env } = {}) {
  return loadZcodeAuthCandidates({ home, env })[0] || null;
}

function buildZcodeSourceHeaders({ home, env } = {}) {
  const headers = {
    "User-Agent": `ZCode/${resolveZcodeAppVersion({ home, env })}`,
    "HTTP-Referer": "https://zcode.z.ai/",
    "X-ZCode-App-Version": resolveZcodeAppVersion({ home, env }),
    "X-Platform": process.platform,
    "X-Release-Channel": "stable",
    "X-Client-Language": Intl.DateTimeFormat().resolvedOptions().locale || "en-US",
    "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    "X-Os-Category": process.platform,
    "X-Os-Version": os.release(),
  };
  const deviceMid = loadZcodeCredential("zcodefeedbackclientid", { home, env });
  if (deviceMid) headers["X-Device-Mid"] = deviceMid;
  return headers;
}

function zcodeValNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function zcodeTsToIso(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  return null;
}

function clampPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

function buildWindow({ usedPercent, resetAt }) {
  const pct = clampPercent(usedPercent);
  if (pct === null) return null;
  return {
    used_percent: pct,
    reset_at: typeof resetAt === "string" && resetAt ? resetAt : null,
  };
}

// Z.ai coding-plan ids look like "zcode-v3-start-plan-0615". The raw id reads
// terribly as a plan label, so extract just the human tier ("Start"/"Lite"/
// "Pro"/"Max"); fall back to null (→ bare "ZCode") when no known tier matches.
function deriveZcodePlanLabel(planId) {
  if (typeof planId !== "string" || !planId) return null;
  const m = planId.toLowerCase().match(/\b(lite|start|pro|max|team|enterprise)\b/);
  if (!m) return null;
  return m[1].charAt(0).toUpperCase() + m[1].slice(1);
}

function normalizeZcodeBalanceResponse(body) {
  const data = body?.data;
  if (!data || typeof data !== "object") {
    throw new Error("Could not parse ZCode balance: missing data");
  }

  const balances = Array.isArray(data.balances) ? data.balances : [];
  if (!balances.length) {
    return {
      server_time: zcodeValNumber(data.server_time),
      plan_kind: "start-plan",
      plan_id: null,
      plan_label: null,
      buckets: [],
      primary_window: null,
      secondary_window: null,
      tertiary_window: null,
    };
  }

  const serverTime = zcodeValNumber(data.server_time);
  const buckets = balances.map((b) => {
    const total = zcodeValNumber(b.total_units);
    const used = zcodeValNumber(b.used_units);
    const remaining = zcodeValNumber(b.remaining_units);
    const periodEnd = zcodeValNumber(b.period_end) || zcodeValNumber(b.expires_at);
    const resetAt = zcodeTsToIso(periodEnd);
    const usedPercent =
      total != null && total > 0 && used != null ? (used / total) * 100 : null;

    return {
      show_name: typeof b.show_name === "string" ? b.show_name : "",
      entitlement_id: typeof b.entitlement_id === "string" ? b.entitlement_id : "",
      total_units: total,
      used_units: used,
      remaining_units: remaining,
      window: buildWindow({ usedPercent, resetAt }),
    };
  });

  // Primary window: highest-priority bucket (GLM-5.2 typically)
  // Secondary window: second bucket (GLM-5-Turbo typically)
  const sorted = buckets.slice().sort((a, b) => {
    const aTotal = a.total_units || 0;
    const bTotal = b.total_units || 0;
    return bTotal - aTotal;
  });

  const planId = typeof balances[0]?.plan_id === "string" ? balances[0].plan_id : null;
  return {
    server_time: serverTime,
    plan_kind: "start-plan",
    plan_id: planId,
    plan_label: deriveZcodePlanLabel(planId),
    buckets: sorted,
    primary_window: sorted[0]?.window || null,
    secondary_window: sorted[1]?.window || null,
    tertiary_window: sorted[2]?.window || null,
  };
}

async function fetchZcodeBilling(apiKey, { fetchImpl = fetch, baseUrl, env, home } = {}) {
  const root = (baseUrl || resolveZcodeBillingBaseUrl(env)).replace(/\/$/, "");
  const url = new URL(`${root}/billing/balance`);
  const appVersion = resolveZcodeAppVersion({ home, env });
  if (appVersion) url.searchParams.set("app_version", appVersion);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (url.origin === new URL(DEFAULT_BILLING_BASE_URL).origin) {
    Object.assign(headers, buildZcodeSourceHeaders({ home, env }));
  }
  const res = await fetchImpl(url.toString(), {
    method: "GET",
    headers,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Not authenticated with ZCode. Run `zcode` in Terminal to log in.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (body && typeof body === "object") {
        const code = body.code != null ? ` code=${body.code}` : "";
        const msg = body.msg ? ` msg=${body.msg}` : "";
        detail = `${code}${msg}`;
      }
    } catch (_error) {
      detail = "";
    }
    throw new Error(`ZCode billing API returned ${res.status}${detail}`);
  }
  return res.json();
}

async function fetchZcodeCodingPlanQuota(apiKey, { fetchImpl = fetch, quotaUrl } = {}) {
  const res = await fetchImpl(quotaUrl, {
    method: "GET",
    headers: {
      authorization: apiKey,
      Accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Not authenticated with ZCode coding plan. Run `zcode` in Terminal to log in.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch (_error) {
    body = null;
  }
  if (!res.ok) {
    const code = body?.code != null ? ` code=${body.code}` : "";
    const msg = body?.msg || body?.message ? ` msg=${body.msg || body.message}` : "";
    throw new Error(`ZCode coding plan API returned ${res.status}${code}${msg}`);
  }
  return body;
}

function quotaTimestampToIso(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value.trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const n = zcodeValNumber(value);
  if (n == null || n <= 0) return null;
  return new Date(n > 10_000_000_000 ? n : n * 1000).toISOString();
}

function findZcodeQuotaLimit(limits, type, unit, number = null) {
  if (!Array.isArray(limits)) return null;
  return (
    limits.find((limit) => {
      if (!limit || typeof limit !== "object") return false;
      if (limit.type !== type) return false;
      if (zcodeValNumber(limit.unit) !== unit) return false;
      if (number == null) return true;
      return zcodeValNumber(limit.number) === number;
    }) || null
  );
}

// ZCode 3.3.x coding-plan quota rows expose `percentage` as already-used %
// (0–100). `unit`/`number` identify the window (5h / weekly / tools), not a
// token total — deriving used% from usage/number turns an unused TIME_LIMIT
// (usage=100, number=1, percentage=0) into a false 100% bar.
function normalizeZcodeQuotaLimit(limit, { showName } = {}) {
  if (!limit || typeof limit !== "object") return null;
  const total = zcodeValNumber(limit.number);
  const used = zcodeValNumber(limit.usage) ?? zcodeValNumber(limit.currentValue);
  const remaining = zcodeValNumber(limit.remaining);
  const rawPercentage = zcodeValNumber(limit.percentage);
  let usedPercent = null;
  if (rawPercentage != null) {
    usedPercent = rawPercentage;
  } else if (total != null && total > 0 && used != null) {
    usedPercent = (used / total) * 100;
  } else if (total != null && total > 0 && remaining != null && remaining <= total) {
    usedPercent = ((total - remaining) / total) * 100;
  }

  const detail = Array.isArray(limit.usageDetails) ? limit.usageDetails.find((item) => item && typeof item === "object") : null;
  const resolvedShowName =
    (typeof showName === "string" && showName.trim())
    || (typeof detail?.displayName === "string" && detail.displayName.trim())
    || (typeof detail?.modelCode === "string" && detail.modelCode.trim())
    || (typeof limit.type === "string" && limit.type.trim())
    || "Coding plan";

  return {
    show_name: resolvedShowName,
    entitlement_id: typeof limit.type === "string" ? limit.type : "",
    total_units: rawPercentage != null ? null : total,
    used_units: rawPercentage != null ? null : used,
    remaining_units: rawPercentage != null ? null : remaining,
    window: buildWindow({ usedPercent, resetAt: quotaTimestampToIso(limit.nextResetTime) }),
  };
}

function normalizeZcodeCodingPlanQuotaResponse(body) {
  const code = typeof body?.code === "number" ? body.code : null;
  if (code !== null && code !== 0 && code !== 200) {
    throw new Error(`ZCode coding plan API error: code=${code} msg=${body?.msg || body?.message || "unknown"}`);
  }
  if (body?.success === false) {
    throw new Error(`ZCode coding plan API error: msg=${body?.msg || body?.message || "unknown"}`);
  }
  const data = body?.data;
  if (!data || typeof data !== "object") {
    throw new Error("Could not parse ZCode coding plan quota: missing data");
  }
  const limits = Array.isArray(data.limits) ? data.limits : [];
  // Match ZCode's own sidebar: TOKENS_LIMIT(unit=3,number=5)=5h,
  // TOKENS_LIMIT(unit=6)=weekly, TIME_LIMIT(unit=5,number=1)=tool calls.
  const fiveHourLimit = findZcodeQuotaLimit(limits, "TOKENS_LIMIT", 3, 5);
  const weeklyLimit = findZcodeQuotaLimit(limits, "TOKENS_LIMIT", 6);
  const toolsLimit = findZcodeQuotaLimit(limits, "TIME_LIMIT", 5, 1);
  const hasNamedWindows = Boolean(fiveHourLimit || weeklyLimit || toolsLimit);

  let buckets;
  if (hasNamedWindows) {
    buckets = [
      fiveHourLimit ? normalizeZcodeQuotaLimit(fiveHourLimit, { showName: "5h" }) : null,
      weeklyLimit ? normalizeZcodeQuotaLimit(weeklyLimit, { showName: "Weekly" }) : null,
      toolsLimit ? normalizeZcodeQuotaLimit(toolsLimit, { showName: "Tools" }) : null,
    ].filter((bucket) => bucket?.window);
  } else {
    buckets = limits.map((limit) => normalizeZcodeQuotaLimit(limit)).filter((bucket) => bucket?.window);
    buckets.sort((a, b) => (b.total_units || 0) - (a.total_units || 0));
  }

  const level = typeof data.level === "string" && data.level.trim() ? data.level.trim() : null;
  return {
    server_time: null,
    plan_kind: "coding-plan",
    plan_id: level,
    plan_label: level ? deriveZcodePlanLabel(level) || level : "Coding",
    buckets,
    primary_window: buckets[0]?.window || null,
    secondary_window: buckets[1]?.window || null,
    tertiary_window: buckets[2]?.window || null,
  };
}

function parseZcodeLogTimestamp(line) {
  const match = line.match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, ms] = match;
  const timestamp = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(ms),
  );
  const time = timestamp.getTime();
  return Number.isFinite(time) ? time : null;
}

function formatZcodeLogDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function recentZcodeLogPaths({ home, env, nowMs = Date.now() } = {}) {
  const logsDir = path.join(resolveZcodeHome({ home, env }), "v2", "logs");
  const today = new Date(nowMs);
  const yesterday = new Date(nowMs - 24 * 60 * 60 * 1000);
  return [today, yesterday].map((d) => path.join(logsDir, `${formatZcodeLogDate(d)}.log`));
}

function extractZcodeBalanceLogRecord(line) {
  if (!line.includes("[usage-stats] billing/balance 请求完成")) return null;
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const entry = JSON.parse(line.slice(jsonStart));
    const body = entry?.payload;
    if (!entry?.success || entry?.code !== 0 || !body || body?.code !== 0) return null;
    if (!Array.isArray(body?.data?.balances) || body.data.balances.length === 0) return null;
    const timestampMs = parseZcodeLogTimestamp(line);
    if (timestampMs == null) return null;
    return {
      body,
      providerKey: typeof entry.providerId === "string" ? entry.providerId : null,
      timestampMs,
      log_timestamp: new Date(timestampMs).toISOString(),
    };
  } catch (_error) {
    return null;
  }
}

function loadLatestZcodeBalanceFromLogs({
  home,
  env = process.env,
  providerKeys = [],
  nowMs = Date.now(),
  requireProviderMatch = false,
} = {}) {
  if (env.TOKENTRACKER_ZCODE_DISABLE_LOG_FALLBACK === "1") return null;
  const maxAgeMs = parsePositiveInteger(env.TOKENTRACKER_ZCODE_LOG_MAX_AGE_MS, DEFAULT_ZCODE_LOG_FALLBACK_MAX_AGE_MS);
  const preferredProviders = new Set(providerKeys.filter(Boolean));
  let preferred = null;
  let fallback = null;
  for (const logPath of recentZcodeLogPaths({ home, env, nowMs })) {
    if (!fs.existsSync(logPath)) continue;
    let text = "";
    try {
      text = fs.readFileSync(logPath, "utf8");
    } catch (_error) {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const record = extractZcodeBalanceLogRecord(lines[i]);
      if (!record) continue;
      const ageMs = nowMs - record.timestampMs;
      if (ageMs < 0 || ageMs > maxAgeMs) continue;
      if (!fallback || record.timestampMs > fallback.timestampMs) fallback = record;
      if (preferredProviders.has(record.providerKey) && (!preferred || record.timestampMs > preferred.timestampMs)) {
        preferred = record;
      }
    }
  }
  if (preferred) return preferred;
  return requireProviderMatch && preferredProviders.size > 0 ? null : fallback;
}

function zcodeLogFallbackResult(logRecord, errors = []) {
  if (!logRecord) return null;
  return {
    configured: true,
    error: null,
    source: "zcode-log",
    provider_key: logRecord.providerKey,
    log_timestamp: logRecord.log_timestamp,
    provider_errors: errors,
    ...normalizeZcodeBalanceResponse(logRecord.body),
  };
}

async function fetchZcodeLimits({ home, env, fetchImpl = fetch, nowMs = Date.now() } = {}) {
  if (!isZcodeInstalled({ home, env })) {
    return { configured: false };
  }
  const authCandidates = loadZcodeAuthCandidates({ home, env });
  if (!authCandidates.length) {
    const logFallback = loadLatestZcodeBalanceFromLogs({ home, env, nowMs });
    if (logFallback) return zcodeLogFallbackResult(logFallback, []);
    return { configured: false };
  }
  const errors = [];
  let emptySuccess = null;
  for (const auth of authCandidates) {
    try {
      const body = auth.planKind === "coding-plan"
        ? await fetchZcodeCodingPlanQuota(auth.apiKey, {
            fetchImpl,
            quotaUrl: auth.quotaUrl,
          })
        : await fetchZcodeBilling(auth.apiKey, {
            fetchImpl,
            baseUrl: auth.billingBaseUrl,
            env,
            home,
          });
      const normalized = auth.planKind === "coding-plan"
        ? normalizeZcodeCodingPlanQuotaResponse(body)
        : normalizeZcodeBalanceResponse(body);
      if (auth.planKind !== "coding-plan") {
        const apiCode = typeof body?.code === "number" ? body.code : null;
        if (apiCode !== null && apiCode !== 0) {
          throw new Error(`ZCode billing API error: code=${apiCode} msg=${body?.msg || "unknown"}`);
        }
      }
      const result = {
        configured: true,
        error: null,
        provider_key: auth.providerKey,
        ...normalized,
      };
      if (Array.isArray(normalized.buckets) && normalized.buckets.length === 0 && authCandidates.length > 1) {
        emptySuccess = emptySuccess || result;
        continue;
      }
      return result;
    } catch (error) {
      errors.push(`${auth.providerKey}: ${error?.message || "Unknown error"}`);
    }
  }
  if (emptySuccess) return emptySuccess;
  const logFallback = loadLatestZcodeBalanceFromLogs({
    home,
    env,
    providerKeys: authCandidates.map((auth) => auth.providerKey),
    nowMs,
    requireProviderMatch: authCandidates.some((auth) => auth.planKind === "coding-plan"),
  });
  if (logFallback) return zcodeLogFallbackResult(logFallback, errors);
  return {
    configured: true,
    error: errors[0] || "Unknown error",
    provider_errors: errors,
  };
}

module.exports = {
  resolveZcodeHome,
  resolveZcodeBillingBaseUrl,
  resolveZcodeAppVersion,
  isZcodeInstalled,
  loadZcodeProviderAvailability,
  loadZcodeSelectedPlanProviderKeys,
  loadZcodeCredential,
  loadLatestZcodeBalanceFromLogs,
  resolveZcodeProviderBillingBaseUrl,
  resolveZcodeProviderQuotaUrl,
  loadZcodeAuthCandidates,
  loadZcodeApiKey,
  deriveZcodePlanLabel,
  normalizeZcodeBalanceResponse,
  normalizeZcodeCodingPlanQuotaResponse,
  fetchZcodeBilling,
  fetchZcodeCodingPlanQuota,
  fetchZcodeLimits,
};
