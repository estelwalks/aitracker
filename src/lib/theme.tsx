import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { MessageKey } from "./i18n/messages";

export const themes = [
  {
    id: "dark",
    labelKey: "theme.dark.label",
    descKey: "theme.dark.desc",
    cls: "",
  },
  {
    id: "light",
    labelKey: "theme.light.label",
    descKey: "theme.light.desc",
    cls: "theme-light",
  },
  {
    id: "contrast",
    labelKey: "theme.contrast.label",
    descKey: "theme.contrast.desc",
    cls: "theme-contrast",
  },
  {
    id: "warm",
    labelKey: "theme.warm.label",
    descKey: "theme.warm.desc",
    cls: "theme-warm",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;
  cls: string;
}>;

export type ThemeId = (typeof themes)[number]["id"];

const ThemeCtx = createContext<{
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}>({
  theme: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("tt-theme") as ThemeId | null;
    if (saved && themes.some((t) => t.id === saved)) setTheme(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    themes.forEach((t) => t.cls && root.classList.remove(t.cls));
    const cls = themes.find((t) => t.id === theme)?.cls;
    if (cls) root.classList.add(cls);
    window.localStorage.setItem("tt-theme", theme);
  }, [theme]);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
