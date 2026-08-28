/** Ordinary window closes are hidden; an explicit tray quit must be allowed. */
export function shouldHideWindowOnClose(isQuitting: boolean): boolean {
  return !isQuitting;
}
