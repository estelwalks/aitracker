import { createLazyFileRoute } from "@tanstack/react-router";

import { JarvisWidget } from "../modules/widget/presentation/JarvisWidget";
import { WidgetPage } from "../modules/widget/presentation/WidgetPage";

export const Route = createLazyFileRoute("/widget")({
  component: WidgetRoutePage,
});

function WidgetRoutePage() {
  const { mode } = Route.useSearch();
  if (mode === "float") {
    return (
      <div className="tt-xscroll py-1">
        <JarvisWidget className="mx-auto" />
      </div>
    );
  }
  return <WidgetPage />;
}
