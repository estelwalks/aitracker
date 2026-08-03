import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "../components/tt";

export const Route = createFileRoute("/sources")({
  head: () => ({
    meta: [
      { title: "数据来源 · AITracker V3.0" },
      {
        name: "description",
        content: "查看与管理本机 AI 工具的数据采集来源。",
      },
    ],
  }),
  component: SourcesPage,
});

function SourcesPage() {
  return (
    <>
      <PageHeader
        eyebrow="本地采集"
        title="数据来源"
        desc="查看与管理本机 AI 工具的数据采集来源"
      />
      <Panel title="数据来源">
        <p className="text-[13px] text-muted-foreground">
          数据来源页（FR-009）—— 开发中
        </p>
      </Panel>
    </>
  );
}
