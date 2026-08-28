export interface MenuBarDisplayInput {
  readonly dynamic: boolean;
  readonly tokens: string;
  readonly tool: string;
  readonly detail: string;
  /** One already-localized, compact insight line for the native title. */
  readonly insight?: string;
}

export const MAX_MENU_BAR_TITLE_LENGTH = 80;

/** Remove empty candidates and avoid repeating the same short insight. */
export function buildMenuBarInsights(
  candidates: readonly (string | null | undefined)[],
): readonly string[] {
  const seen = new Set<string>();
  const insights: string[] = [];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    insights.push(value);
  }
  return insights;
}

function clampMenuBarTitle(title: string): string {
  if (title.length <= MAX_MENU_BAR_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_MENU_BAR_TITLE_LENGTH - 1)}…`;
}

/** Build the native macOS status-item text for compact and dynamic modes. */
export function buildMenuBarTitle({
  dynamic,
  tokens,
  tool,
  detail,
  insight,
}: MenuBarDisplayInput): string {
  if (!dynamic) return tokens;
  const summary = insight?.trim() || `${tool} · ${detail}`;
  return clampMenuBarTitle(`${tokens} · ${summary}`);
}
