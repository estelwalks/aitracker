import { createFileRoute } from "@tanstack/react-router";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { DistillationPage } from "../modules/distillation/presentation/DistillationPage";
import { getDistillationQuery } from "../modules/distillation/query";

export const Route = createFileRoute("/distill")({
  loader: ({ location }) =>
    getDistillationQuery({
      data: resolveLocaleFromSearch(location.search),
    }).then((data) => ({
      ...data,
      locale: resolveLocaleFromSearch(location.search),
    })),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.distill",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "common.distillation.pageDesc",
        ),
      },
    ],
  }),
  component: DistillationRoutePage,
});

function DistillationRoutePage() {
  const data = Route.useLoaderData();
  return <DistillationPage initial={data} />;
}
