import {
  getUsageSources,
  refreshUsageSources,
} from "../../../lib/local-usage/get-usage-sources";
import {
  toSourcesQuerySummary,
  type SourcesQuerySummary,
} from "./presentation/model";

export async function getSourcesQuery(): Promise<SourcesQuerySummary> {
  return toSourcesQuerySummary(await getUsageSources());
}

export async function refreshSourcesQuery(): Promise<SourcesQuerySummary> {
  return toSourcesQuerySummary(await refreshUsageSources());
}
