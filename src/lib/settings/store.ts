import { useEffect, useState } from "react";

import { parseUserSecurityRules, type UserSecurityRule } from "../security/rules.ts";

export interface ProviderBudget {
  provider: string;
  dailyBudget: number;
  weeklyBudget: number;
  monthlyBudget: number;
}

export interface TrustToolsSettings {
  autoDiscoverAgents: boolean;
  collectionFrequency: "realtime" | "5m" | "30m";
  monitoredDirectories: string[];
  memoryAutoDiscover: boolean;
  memoryDirectories: string[];
  memoryExcludes: string[];
  lowFrequencyCount: number;
  dozeDays: number;
  deadDays: number;
  trashMinutes: 5;
  dailyBudget: number;
  weeklyBudget: number;
  monthlyBudget: number;
  providerBudgets: ProviderBudget[];
  alertThreshold: 80 | 90 | 100;
  launchAtLoginRequested: boolean;
  securityRules: UserSecurityRule[];
}

export const DEFAULT_SETTINGS: TrustToolsSettings = {
  autoDiscoverAgents: true,
  collectionFrequency: "realtime",
  monitoredDirectories: [],
  memoryAutoDiscover: true,
  memoryDirectories: [],
  memoryExcludes: ["node_modules", ".git", "dist"],
  lowFrequencyCount: 5,
  dozeDays: 30,
  deadDays: 90,
  trashMinutes: 5,
  dailyBudget: 30,
  weeklyBudget: 150,
  monthlyBudget: 500,
  providerBudgets: [],
  alertThreshold: 90,
  launchAtLoginRequested: false,
  securityRules: [],
};

const STORAGE_KEY = "trusttools.settings.v1";

function parseProviderBudgets(candidate: unknown): ProviderBudget[] {
  if (!Array.isArray(candidate)) return [];

  const providers = new Set<string>();
  const budgets: ProviderBudget[] = [];
  for (const item of candidate) {
    if (item == null || typeof item !== "object") continue;
    const value = item as Partial<Record<keyof ProviderBudget, unknown>>;
    if (typeof value.provider !== "string") continue;
    const provider = value.provider.trim();
    const normalizedProvider = provider.toLowerCase();
    if (!provider || providers.has(normalizedProvider)) continue;

    const safeBudget = (budget: unknown) =>
      typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : 0;
    providers.add(normalizedProvider);
    budgets.push({
      provider,
      dailyBudget: safeBudget(value.dailyBudget),
      weeklyBudget: safeBudget(value.weeklyBudget),
      monthlyBudget: safeBudget(value.monthlyBudget),
    });
  }
  return budgets;
}

export function parseSettings(raw: string | null): TrustToolsSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<TrustToolsSettings>;
    const frequency = ["realtime", "5m", "30m"].includes(String(value.collectionFrequency))
      ? (value.collectionFrequency as TrustToolsSettings["collectionFrequency"])
      : DEFAULT_SETTINGS.collectionFrequency;
    const threshold = [80, 90, 100].includes(Number(value.alertThreshold))
      ? (Number(value.alertThreshold) as TrustToolsSettings["alertThreshold"])
      : DEFAULT_SETTINGS.alertThreshold;
    const numberValue = (candidate: unknown, fallback: number) =>
      typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
        ? candidate
        : fallback;
    return {
      ...DEFAULT_SETTINGS,
      autoDiscoverAgents:
        typeof value.autoDiscoverAgents === "boolean"
          ? value.autoDiscoverAgents
          : DEFAULT_SETTINGS.autoDiscoverAgents,
      collectionFrequency: frequency,
      monitoredDirectories: Array.isArray(value.monitoredDirectories)
        ? value.monitoredDirectories.filter((item): item is string => typeof item === "string")
        : [],
      memoryAutoDiscover:
        typeof value.memoryAutoDiscover === "boolean"
          ? value.memoryAutoDiscover
          : DEFAULT_SETTINGS.memoryAutoDiscover,
      memoryDirectories: Array.isArray(value.memoryDirectories)
        ? value.memoryDirectories.filter((item): item is string => typeof item === "string")
        : [],
      memoryExcludes: Array.isArray(value.memoryExcludes)
        ? value.memoryExcludes.filter((item): item is string => typeof item === "string")
        : DEFAULT_SETTINGS.memoryExcludes,
      lowFrequencyCount: numberValue(value.lowFrequencyCount, DEFAULT_SETTINGS.lowFrequencyCount),
      dozeDays: numberValue(value.dozeDays, DEFAULT_SETTINGS.dozeDays),
      deadDays: numberValue(value.deadDays, DEFAULT_SETTINGS.deadDays),
      trashMinutes: 5,
      dailyBudget: numberValue(value.dailyBudget, DEFAULT_SETTINGS.dailyBudget),
      weeklyBudget: numberValue(value.weeklyBudget, DEFAULT_SETTINGS.weeklyBudget),
      monthlyBudget: numberValue(value.monthlyBudget, DEFAULT_SETTINGS.monthlyBudget),
      providerBudgets: parseProviderBudgets(value.providerBudgets),
      alertThreshold: threshold,
      launchAtLoginRequested:
        typeof value.launchAtLoginRequested === "boolean"
          ? value.launchAtLoginRequested
          : DEFAULT_SETTINGS.launchAtLoginRequested,
      securityRules: parseUserSecurityRules(value.securityRules),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useTrustToolsSettings() {
  const [settings, setSettings] = useState<TrustToolsSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(parseSettings(window.localStorage.getItem(STORAGE_KEY)));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [loaded, settings]);

  return { settings, setSettings, loaded };
}
