import { createLazyFileRoute } from "@tanstack/react-router";

import { SecurityAssessmentPage } from "../modules/security-assessment/presentation/SecurityAssessmentPage";

export const Route = createLazyFileRoute("/security")({
  component: SecurityAssessmentPage,
});
