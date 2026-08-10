import { createFileRoute } from "@tanstack/react-router";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { SecurityAssessmentPage } from "../modules/security-assessment/presentation/SecurityAssessmentPage";

export const Route = createFileRoute("/security")({
  loader: ({ location }) => ({
    locale: resolveLocaleFromSearch(location.search),
  }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.security",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "security.pageDescription",
        ),
      },
    ],
  }),
  component: SecurityAssessmentPage,
});
