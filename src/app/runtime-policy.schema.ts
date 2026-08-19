import { z } from "zod";

import { JOB_EXECUTOR_KEYS } from "../modules/tasks/definitions/contracts.ts";
import { JobTypeDefinitionSchema } from "../modules/tasks/definitions/contracts.ts";

/**
 * Strict schema for the single human-maintained runtime policy source
 * (`src/app/runtime-policy.source.json`). This file is the ONLY authoritative
 * location for product-level freshness, refresh periods, timeouts, network
 * permission and resource budgets. The generated projection
 * (`runtime-policy.generated.ts`) is derived from it and must never be edited
 * by hand (see `scripts/generate-runtime-policy.mjs` and
 * `scripts/verify-runtime-policy.mjs`).
 *
 * Validation rules (enforced here and by the generator):
 * - Unknown fields, negative/zero/out-of-range values, duplicate task ids and
 *   unregistered executors all fail validation.
 * - A snapshot policy whose domain has a matching scheduled job (usage.refresh,
 *   sessions.refresh, skills.refresh) must declare a `defaultRefreshMinutes`
 *   equal to the job's interval — there must never be two independently
 *   editable periods for the same fact.
 */

export const SNAPSHOT_POLICY_KEYS = [
  "exchangeRates",
  "usage",
  "sessions",
  "skills",
  "toolInstallations",
  "wslTopology",
  "skillMarketEvidence",
] as const;
export type SnapshotPolicyKey = (typeof SNAPSHOT_POLICY_KEYS)[number];

export const SNAPSHOT_STARTUP_POLICIES = [
  "disabled",
  "if-stale",
  "on-demand-if-stale",
] as const;
export type SnapshotStartupPolicy = (typeof SNAPSHOT_STARTUP_POLICIES)[number];

export const snapshotPolicySchema = z
  .object({
    /** Minutes after which the snapshot is considered stale for reads. */
    freshForMinutes: z.number().int().min(1).max(10080),
    /** Minutes after which the scheduler defaults to attempting a refresh. */
    defaultRefreshMinutes: z.number().int().min(1).max(10080),
    startupPolicy: z.enum(SNAPSHOT_STARTUP_POLICIES),
    /** Stale snapshots remain readable (last-known-good semantics). */
    staleReadable: z.boolean(),
    /** Manual refresh is permitted for this domain. */
    manualRefresh: z.boolean(),
    timeoutMs: z.number().int().min(1000).max(86_400_000),
    network: z.enum(["forbidden", "allowed"]),
  })
  .strict();

export type SnapshotPolicy = z.infer<typeof snapshotPolicySchema>;

/** The stable mapping between a snapshot domain and its scheduled job id. */
export const SNAPSHOT_TO_JOB: Readonly<
  Partial<Record<SnapshotPolicyKey, string>>
> = {
  usage: "usage.refresh",
  sessions: "sessions.refresh",
  skills: "skills.refresh",
  exchangeRates: "exchange.refresh",
  toolInstallations: "installation.refresh",
};

export const resourceBudgetsSchema = z
  .object({
    maxHeavyCollectors: z.number().int().min(1).max(8),
    maxFileOperations: z.number().int().min(1).max(64),
    maxProjectClassifiers: z.number().int().min(1).max(32),
  })
  .strict();

export const rolloutSchema = z
  .object({
    defaultStage: z.enum([
      "compact-read-model",
      "snapshot-read",
      "unified-refresh",
      "new-default",
    ]),
  })
  .strict();

export const RuntimePolicySourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotPolicies: z
      .object({
        exchangeRates: snapshotPolicySchema,
        usage: snapshotPolicySchema,
        sessions: snapshotPolicySchema,
        skills: snapshotPolicySchema,
        toolInstallations: snapshotPolicySchema,
        wslTopology: snapshotPolicySchema,
        skillMarketEvidence: snapshotPolicySchema,
      })
      .strict(),
    scheduledJobs: z
      .object({
        schemaVersion: z.literal(1),
        tasks: z.array(JobTypeDefinitionSchema).min(1),
      })
      .strict(),
    resourceBudgets: resourceBudgetsSchema,
    rollout: rolloutSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    // Duplicate task ids and default interval inside constraints are already
    // enforced by JobCatalogSchema; re-validate executor registration here so
    // a stale executor list can never silently pass the policy generator.
    const ids = new Set<string>();
    for (const task of value.scheduledJobs.tasks) {
      if (ids.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scheduledJobs", "tasks"],
          message: `duplicate task id: ${task.id}`,
        });
      }
      ids.add(task.id);
      if (!JOB_EXECUTOR_KEYS.includes(task.executorKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scheduledJobs", "tasks"],
          message: `unregistered executor: ${task.executorKey}`,
        });
      }
      if (task.defaultSchedule.kind === "interval") {
        const minutes = task.defaultSchedule.minutes!;
        if (
          minutes < task.constraints.minMinutes ||
          minutes > task.constraints.maxMinutes
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["scheduledJobs", "tasks"],
            message: `${task.id} default interval outside constraints`,
          });
        }
      }
    }
    // A domain with a scheduled job must agree on the refresh period. The
    // snapshot policy is the editable authority; the job definition must match.
    for (const key of SNAPSHOT_POLICY_KEYS) {
      const policy = value.snapshotPolicies[key];
      const jobId = SNAPSHOT_TO_JOB[key];
      const job = jobId
        ? value.scheduledJobs.tasks.find((task) => task.id === jobId)
        : undefined;
      if (!job) continue;
      if (job.defaultSchedule.kind !== "interval") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["snapshotPolicies", key],
          message: `${key} policy requires an interval job for ${jobId}`,
        });
        continue;
      }
      if (job.defaultSchedule.minutes !== policy.defaultRefreshMinutes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["snapshotPolicies", key],
          message: `${key}.defaultRefreshMinutes (${policy.defaultRefreshMinutes}) must equal ${jobId} interval (${job.defaultSchedule.minutes})`,
        });
      }
      if (job.timeoutMs !== policy.timeoutMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["snapshotPolicies", key],
          message: `${key}.timeoutMs (${policy.timeoutMs}) must equal ${jobId} timeoutMs (${job.timeoutMs})`,
        });
      }
      // Startup behaviour must agree: a snapshot policy that declares
      // `startupPolicy: "if-stale"` can never pair with a job that stays
      // `disabled` at startup — otherwise the stale snapshot would never be
      // refreshed until the first scheduled interval fires.
      if (job.startupPolicy !== policy.startupPolicy) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["snapshotPolicies", key],
          message: `${key}.startupPolicy (${policy.startupPolicy}) must equal ${jobId} startupPolicy (${job.startupPolicy})`,
        });
      }
    }
  });

export type RuntimePolicySource = z.infer<typeof RuntimePolicySourceSchema>;
