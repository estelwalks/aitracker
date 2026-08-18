import { createLazyFileRoute } from "@tanstack/react-router";

import { MemoryPage } from "../modules/knowledge/presentation/MemoryPage";

export const Route = createLazyFileRoute("/memory")({
  component: MemoryRoutePage,
});

function MemoryRoutePage() {
  return <MemoryPage />;
}
