import { createLazyFileRoute } from "@tanstack/react-router";

import { SecurityAssessmentPage } from "../modules/security-assessment/presentation/SecurityAssessmentPage";
import { InsightCard } from "../modules/insights/page/presentation/insight-card";

export const Route = createLazyFileRoute("/security")({
  component: SecurityRoute,
});

function SecurityRoute() {
  return (
    <div className="space-y-5">
      <InsightCard surfaceId="security" variant="hero" />
      <SecurityAssessmentPage />
    </div>
  );
}
