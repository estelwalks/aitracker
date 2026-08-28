export interface ReloadShortcutInput {
  readonly type: string;
  readonly key: string;
  readonly control?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/** Browser reload accelerators that must stay disabled in packaged clients. */
export function isReloadShortcut(input: ReloadShortcutInput): boolean {
  if (input.type !== "keyDown") return false;
  const key = input.key.toLowerCase();
  return (
    key === "f5" ||
    (key === "r" && (input.control === true || input.meta === true))
  );
}
