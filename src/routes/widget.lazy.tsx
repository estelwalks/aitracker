import { useEffect } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";

import { GlassOverviewWidget } from "../modules/widget/presentation/GlassOverviewWidget";

export const Route = createLazyFileRoute("/widget")({
  component: WidgetRoutePage,
});

function WidgetRoutePage() {
  const { mode } = Route.useSearch();

  useEffect(() => {
    if (mode !== "float") return;
    document.documentElement.classList.add("aitracker-widget-float-document");
    document.body.classList.add("aitracker-widget-float-document");
    return () => {
      document.documentElement.classList.remove(
        "aitracker-widget-float-document",
      );
      document.body.classList.remove("aitracker-widget-float-document");
    };
  }, [mode]);

  return (
    <div className="aitracker-widget-float-stage">
      <GlassOverviewWidget />
    </div>
  );
}
