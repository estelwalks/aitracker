import type {
  AtomicJsonStore,
  Clock,
} from "../../platform/persistence/contracts.ts";
import type {
  AssetAssessment,
  AssetHashRef,
  AssetRef,
  SecurityAssessmentPort,
} from "../security-assessment/contracts.ts";

export const skillCatalogModuleId = "skill-catalog" as const;
export type SkillCatalogModuleId = typeof skillCatalogModuleId;

export type PackageHash = `sha256-${string}` & {
  readonly __packageHash: unique symbol;
};
export type SkillRef = `skill:${string}`;
export type PackageRef = `package:${string}`;
export type SkillSourceRef = `skill-source:${string}`;
export type AssessmentRef = `assessment:${string}`;

export type SkillSourceKind = "local" | "market" | "enterprise";
export interface SkillSource {
  readonly kind: SkillSourceKind;
  /** Opaque source identifier; never a path or URL. */
  readonly ref: SkillSourceRef;
  readonly label?: string;
}

export type SecurityVerdict = "clean" | "suspicious" | "dangerous" | "unknown";
export type Installability = "installable" | "blocked";

export interface SkillPackage {
  readonly packageRef: PackageRef;
  readonly skillRef: SkillRef;
  readonly name: string;
  readonly version: string;
  readonly source: SkillSource;
  readonly hash: PackageHash;
  readonly verdict: SecurityVerdict;
  readonly installability: Installability;
  readonly capabilities: readonly string[];
  readonly refs: readonly string[];
  readonly assessmentRef?: AssessmentRef;
}

/** Renderer-safe projection. It intentionally excludes package content and location. */
export type SkillPackageDto = Pick<
  SkillPackage,
  "name" | "version" | "source" | "hash" | "verdict" | "capabilities" | "refs"
> & {
  readonly installability: Installability;
  readonly assessmentRef?: AssessmentRef;
};

export interface SkillPackageMetadataInput {
  readonly name: unknown;
  readonly version: unknown;
  readonly source: unknown;
  readonly hash: unknown;
  readonly capabilities?: unknown;
  readonly refs?: unknown;
}

export interface SkillPackageRecord extends SkillPackage {
  readonly normalizedAt: string;
}

export interface OfflineCacheDocument {
  readonly schemaVersion: 1;
  readonly savedAt: string;
  readonly entries: readonly SkillPackageRecord[];
}

export interface OfflineCache {
  readonly entries: readonly SkillPackageDto[];
  readonly savedAt?: string;
  readonly stale: boolean;
}

export interface SkillCatalogRepositoryOptions {
  readonly store: AtomicJsonStore<OfflineCacheDocument>;
  readonly clock: Clock;
  readonly maxAgeMs?: number;
}

export type SkillSecurityAssessmentPort = SecurityAssessmentPort;

export interface SkillCatalogModuleContract {
  readonly module: SkillCatalogModuleId;
  readonly schemaVersion: 1;
}

export interface SkillPackageAssessment {
  readonly package: SkillPackage;
  readonly assessment: AssetAssessment;
  readonly installability: Installability;
}

export interface SkillCatalogFilter {
  readonly text?: string;
  readonly source?: SkillSourceKind;
  readonly verdict?: SecurityVerdict;
  readonly installability?: Installability;
  readonly capabilities?: readonly string[];
}

export type SkillCatalogErrorCode =
  | "errors.skillCatalog.invalidMetadata"
  | "errors.skillCatalog.invalidHash"
  | "errors.skillCatalog.hashMismatch"
  | "errors.skillCatalog.assessmentRequired"
  | "errors.skillCatalog.assessmentMismatch"
  | "errors.skillCatalog.cacheCorrupt";

export const SKILL_CATALOG_SCHEMA_VERSION = 1 as const;

export interface SkillAssessmentInput {
  readonly packageRef: PackageRef;
  readonly skillRef: SkillRef;
  readonly hash: PackageHash;
  readonly assessment: AssetAssessment;
}

export type { AssetHashRef, AssetRef };
