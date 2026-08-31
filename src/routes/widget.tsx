import { createFileRoute, redirect } from "@tanstack/react-router";

interface WidgetSearchParams {
  /** Passed by the Electron floating panel; this route has no in-app preview. */
  readonly mode?: "float" | null;
}

// This route is an implementation detail for the Electron floating panel.
// Direct navigation is redirected so the removed in-app widget page cannot be
// reached from a saved URL.
export const Route = createFileRoute("/widget")({
  validateSearch: (search: Record<string, unknown>): WidgetSearchParams => ({
    mode: search.mode === "float" ? "float" : null,
  }),
  beforeLoad: ({ search }) => {
    if (search.mode !== "float") {
      throw redirect({ to: "/", replace: true });
    }
  },
});
