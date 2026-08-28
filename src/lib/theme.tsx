import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { MessageKey } from "./i18n/messages";
import { STORAGE_KEY_PREFIX } from "./app-config";
import { getPreference, setPreference } from "./preferences/client.ts";

const THEME_PREFERENCE_KEY = `${STORAGE_KEY_PREFIX}theme`;

export const themes = [
  {
    id: "system",
    labelKey: "theme.system.label",
    descKey: "theme.system.desc",
    cls: "",
  },
  {
    id: "light",
    labelKey: "theme.light.label",
    descKey: "theme.light.desc",
    cls: "theme-light",
  },
  {
    id: "dark",
    labelKey: "theme.dark.label",
    descKey: "theme.dark.desc",
    cls: "",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;
  cls: string;
}>;

export type ThemeId = (typeof themes)[number]["id"];

export const DEFAULT_THEME: ThemeId = "system";

/** Resolve the CSS theme class while keeping `system` as the user preference. */
export function resolveThemeClass(
  theme: ThemeId,
  prefersLight: boolean,
): "theme-light" | "" {
  return theme === "light" || (theme === "system" && prefersLight)
    ? "theme-light"
    : "";
}

/** Keep browser chrome aligned with both system and explicit app themes. */
export function syncFaviconTheme(theme: ThemeId, prefersLight: boolean): void {
  const light = document.querySelector<HTMLLinkElement>("#app-favicon-light");
  const dark = document.querySelector<HTMLLinkElement>("#app-favicon-dark");
  if (!light || !dark) return;

  if (theme === "system") {
    light.media = "(prefers-color-scheme: light)";
    dark.media = "(prefers-color-scheme: dark)";
    return;
  }

  const useLight = resolveThemeClass(theme, prefersLight) === "theme-light";
  light.media = useLight ? "all" : "not all";
  dark.media = useLight ? "not all" : "all";
}

const ThemeCtx = createContext<{
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [systemPrefersLight, setSystemPrefersLight] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersLight(event.matches);
    };

    setSystemPrefersLight(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
    } else {
      media.addListener?.(handleChange);
    }
    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", handleChange);
      } else {
        media.removeListener?.(handleChange);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPreference(THEME_PREFERENCE_KEY).then((saved) => {
      if (!cancelled) {
        if (
          typeof saved === "string" &&
          themes.some((candidate) => candidate.id === saved)
        ) {
          setTheme(saved as ThemeId);
        }
        setHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light");
    const cls = resolveThemeClass(theme, systemPrefersLight);
    if (cls) root.classList.add(cls);
    syncFaviconTheme(theme, systemPrefersLight);
    if (hydrated) void setPreference(THEME_PREFERENCE_KEY, theme);
  }, [hydrated, systemPrefersLight, theme]);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
