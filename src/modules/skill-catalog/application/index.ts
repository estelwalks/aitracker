import { err, ok, type Result } from "../../../shared/result.ts";
import type { AssetAssessment } from "../../security-assessment/contracts.ts";
import {
  applySecurityAssessment,
  normalizeSkillPackage,
  toSkillPackageDto,
  verifyPackageHash,
} from "../domain.ts";
import type {
  PackageHash,
  SkillCatalogErrorCode,
  SkillCatalogModuleContract,
  SkillPackage,
  SkillPackageMetadataInput,
  SkillPackageRecord,
} from "../contracts.ts";

export {
  availableAssetSorts,
  buildSkillAssetSummary,
  buildSkillWorkspace,
  querySkillAssets,
  toSkillAssetView,
} from "./asset-view.ts";
export type {
  AssetSortDirection,
  AssetSortKey,
  AssetSourceFilter,
  AssetUpdateFilter,
  SkillAssetFilters,
  SkillAssetSummary,
  SkillAssetView,
  SkillAgentCoverage,
  SkillWorkspace,
  SkillWorkspaceFacet,
  SkillWorkspaceFacets,
  SkillWorkspaceSummary,
} from "./asset-view.ts";
export {
  formatSkillDisplayName,
  primarySkillDirectoryName,
  skillDirectoryNames,
  skillIdentityNames,
} from "./skill-identity.ts";
export { buildToolOverview } from "./tool-overview.ts";
export type {
  ToolOverviewBreakdownRow,
  ToolOverviewCard,
  ToolOverviewContextRow,
  ToolOverviewSkillUsage,
  ToolOverviewState,
  ToolOverviewTrendPoint,
  ToolOverviewView,
} from "./tool-overview.ts";

export interface SkillCatalogApplication {
  readonly contract: SkillCatalogModuleContract;
}

export function parseSkillPackageMetadata(
  input: unknown,
  now?: string,
): Result<SkillPackageRecord, SkillCatalogErrorCode> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return err("errors.skillCatalog.invalidMetadata");
  }
  try {
    return ok(normalizeSkillPackage(input as SkillPackageMetadataInput, now));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return err(
      message.includes("hash")
        ? "errors.skillCatalog.invalidHash"
        : "errors.skillCatalog.invalidMetadata",
    );
  }
}

export function evaluateInstallability(
  value: SkillPackage,
  assessment?: AssetAssessment,
  actualHash?: PackageHash,
): Result<SkillPackage, SkillCatalogErrorCode> {
  if (actualHash && !verifyPackageHash(value.hash, actualHash)) {
    return err("errors.skillCatalog.hashMismatch");
  }
  if (!assessment) return err("errors.skillCatalog.assessmentRequired");
  const assessed = applySecurityAssessment(value, assessment);
  if (
    assessed.verdict === "unknown" &&
    assessment.assetRef !== `asset:${value.packageRef.slice("package:".length)}`
  ) {
    return err("errors.skillCatalog.assessmentMismatch");
  }
  return ok(assessed);
}

export function projectSkillPackage(value: SkillPackage) {
  return toSkillPackageDto(value);
}
