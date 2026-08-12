/**
 * Renderer helper: turn structured insight descriptors into localized strings
 * for the shared `JarvisInsight` card. Server logic stays language-neutral;
 * formatting happens here at the display boundary via the typed `t()` layer.
 */
import type { I18nContextValue } from "../i18n/context";
import type { MessageKey } from "../i18n/messages";
import type { PageInsight } from "./types";

/** Loose `t` signature used internally (params are pre-formatted strings). */
type RenderTranslate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

export function resolveInsightLines(
  t: I18nContextValue["t"],
  insights: readonly PageInsight[],
): string[] {
  const render = t as unknown as RenderTranslate;
  return insights.map((item) => render(item.key, item.params));
}
