import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "../components/tt";

export const Route = createFileRoute("/sessions")({
  head: () => ({
    meta: [
      { title: "会话恢复 · TrustTools V3.0" },
      {
        name: "description",
        content: "浏览本地历史会话并一键复制恢复命令。",
      },
    ],
  }),
  component: SessionsPage,
});

function SessionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="本地会话"
        title="会话恢复"
        desc="浏览本地历史会话并一键复制恢复命令"
      />
      <Panel title="会话恢复">
        <p className="text-[13px] text-muted-foreground">
          会话恢复页（FR-024~026）—— 开发中
        </p>
      </Panel>
    </>
  );
}
