export interface MenuBarDisplayInput {
  readonly dynamic: boolean;
  readonly tokens: string;
  readonly tool: string;
  readonly detail: string;
}

/** Build the native macOS status-item text for compact and dynamic modes. */
export function buildMenuBarTitle({
  dynamic,
  tokens,
  tool,
  detail,
}: MenuBarDisplayInput): string {
  return dynamic ? `${tokens} · ${tool} · ${detail}` : tokens;
}
