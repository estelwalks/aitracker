import { useEffect } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";

import { GlassOverviewWidget } from "../modules/widget/presentation/GlassOverviewWidget";
import { MenuBarIcon } from "../modules/widget/presentation/MenuBarIcon";
import { WidgetPage } from "../modules/widget/presentation/WidgetPage";

export const Route = createLazyFileRoute("/widget")({
  component: WidgetRoutePage,
});

function WidgetRoutePage() {
  const { mode } = Route.useSearch();

  useEffect(() => {
    if (mode !== "float" && mode !== "bar") return;
    document.documentElement.classList.add("tt-widget-float-document");
    document.body.classList.add("tt-widget-float-document");
    return () => {
      document.documentElement.classList.remove("tt-widget-float-document");
      document.body.classList.remove("tt-widget-float-document");
    };
  }, [mode]);

  if (mode === "bar") {
    return <MenuBarIcon />;
  }
  if (mode === "float") {
    return (
      <div className="tt-widget-float-stage">
        <GlassOverviewWidget />
      </div>
    );
  }
  return <WidgetPage />;
}
