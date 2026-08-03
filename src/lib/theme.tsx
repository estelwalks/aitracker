import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export const themes = [
  { id: "dark", label: "暗色", desc: "默认，日常使用", cls: "" },
  { id: "light", label: "亮色", desc: "白天 / 会议展示", cls: "theme-light" },
  {
    id: "contrast",
    label: "高对比度",
    desc: "投影 / 大屏 / 视力辅助",
    cls: "theme-contrast",
  },
  { id: "warm", label: "暖色", desc: "夜间低蓝光", cls: "theme-warm" },
] as const;

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
