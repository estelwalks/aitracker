import type { AssetAssessment } from "../security-assessment/contracts.ts";
import { evaluatePublishGate } from "../security-assessment/application/index.ts";
import type {
  Installability,
  PackageHash,
  PackageRef,
  SecurityVerdict,
  SkillCatalogFilter,
  SkillPackage,
  SkillPackageDto,
  SkillPackageMetadataInput,
  SkillPackageRecord,
  SkillSource,
  SkillSourceKind,
} from "./contracts.ts";

const HASH = /^sha256-[a-f0-9]{64}$/;
const SAFE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRIVATE =
  /(command|prompt|response|transcript|token|secret|password|credential|content|path|url)/i;
const SOURCE_KINDS = new Set<SkillSourceKind>([
  "local",
  "market",
  "enterprise",
]);

function opaquePart(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\s+/g, "-");
  return SAFE_PART.test(normalized) && !PRIVATE.test(normalized)
    ? normalized
    : fallback;
}

function requiredPart(value: unknown, field: string): string {
  const result = opaquePart(value, "");
  if (!result) throw new TypeError(`Invalid skill ${field}`);
  return result;
}

function sourceFrom(value: unknown): SkillSource | undefined {
  if (typeof value === "string" && SOURCE_KINDS.has(value as SkillSourceKind)) {
    return { kind: value as SkillSourceKind, ref: `skill-source:${value}` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.kind !== "string" ||
    !SOURCE_KINDS.has(row.kind as SkillSourceKind)
  )
    return undefined;
  const kind = row.kind as SkillSourceKind;
  const refPart =
    typeof row.ref === "string" ? row.ref.replace(/^skill-source:/, "") : kind;
  if (!SAFE_REF.test(refPart) || PRIVATE.test(refPart) || /[\\/]/.test(refPart))
    return undefined;
  const label =
    typeof row.label === "string" &&
    row.label.length <= 80 &&
    !PRIVATE.test(row.label)
      ? row.label.trim() || undefined
      : undefined;
  return { kind, ref: `skill-source:${refPart}`, ...(label ? { label } : {}) };
}

function valuesFrom(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" &&
          item.length > 0 &&
          item.length <= 80 &&
          SAFE_REF.test(item) &&
          !PRIVATE.test(item),
      ),
    ),
  ]
    .slice(0, max)
    .sort();
}

export function packageHash(value: string): PackageHash {
  if (!HASH.test(value)) throw new TypeError("Invalid package hash");
  return value as PackageHash;
}

export function normalizeSkillPackage(
  input: SkillPackageMetadataInput,
  now = new Date().toISOString(),
): SkillPackageRecord {
  const name = requiredPart(input.name, "name");
  const version = requiredPart(input.version, "version");
  const source = sourceFrom(input.source);
  if (!source) throw new TypeError("Invalid skill source");
  const hash = packageHash(typeof input.hash === "string" ? input.hash : "");
  const packagePart = `${name}-${version}-${hash.slice(-12)}`;
  const packageRef = `package:${packagePart}` as PackageRef;
  const skillRef = `skill:${name}` as SkillPackage["skillRef"];
  return {
    packageRef,
    skillRef,
    name,
    version,
    source,
    hash,
    verdict: "unknown",
    installability: "blocked",
    capabilities: valuesFrom(input.capabilities, 32),
    refs: valuesFrom(input.refs, 32),
    normalizedAt: now,
  };
}

export function toSkillPackageDto(value: SkillPackage): SkillPackageDto {
  return {
    name: value.name,
    version: value.version,
    source: { ...value.source },
    hash: value.hash,
    verdict: value.verdict,
    installability: value.installability,
    capabilities: [...value.capabilities],
    refs: [...value.refs],
    ...(value.assessmentRef ? { assessmentRef: value.assessmentRef } : {}),
  };
}

export function verifyPackageHash(
  expected: PackageHash,
  actual: PackageHash,
): boolean {
  return expected === actual;
}

export function applySecurityAssessment(
  value: SkillPackage,
  assessment: AssetAssessment,
): SkillPackage {
  const expectedAssetRef = `asset:${value.packageRef.slice("package:".length)}`;
  const expectedHashRef = `asset-hash:${value.hash}`;
  const matches =
    assessment.assetRef === expectedAssetRef &&
    assessment.assetHashRef === expectedHashRef;
  if (!matches) {
    return { ...value, verdict: "unknown", installability: "blocked" };
  }
  const gate = evaluatePublishGate(assessment);
  return {
    ...value,
    verdict: assessment.verdict,
    installability: gate.decision === "allowed" ? "installable" : "blocked",
    assessmentRef: assessment.assessmentRef,
  };
}

export function installabilityFor(
  verdict: SecurityVerdict,
  assessed = true,
): Installability {
  return assessed && verdict === "clean" ? "installable" : "blocked";
}

export function dedupePackages(
  values: readonly SkillPackageRecord[],
): SkillPackageRecord[] {
  const entries = new Map<string, SkillPackageRecord>();
  for (const value of values) {
    const key = `${value.name.toLocaleLowerCase()}@${value.version}:${value.hash}`;
    const current = entries.get(key);
    if (!current || value.normalizedAt > current.normalizedAt)
      entries.set(key, value);
  }
  return [...entries.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

export function filterSkillPackages(
  values: readonly SkillPackageDto[],
  filter: SkillCatalogFilter = {},
): SkillPackageDto[] {
  const text = filter.text?.trim().toLocaleLowerCase();
  return values.filter((value) => {
    if (filter.source && value.source.kind !== filter.source) return false;
    if (filter.verdict && value.verdict !== filter.verdict) return false;
    if (filter.installability && value.installability !== filter.installability)
      return false;
    if (filter.capabilities?.some((item) => !value.capabilities.includes(item)))
      return false;
    if (!text) return true;
    return `${value.name} ${value.version} ${value.source.kind} ${value.capabilities.join(" ")}`
      .toLocaleLowerCase()
      .includes(text);
  });
}
