import { z } from "zod";

export const JOB_EXECUTOR_KEYS = [
  "refresh-usage-v1",
  "refresh-skills-v1",
  "refresh-sessions-v1",
  "monitor-security-v1",
  "apply-retention-v1",
  "generate-report-v1",
  "refresh-exchange-v1",
] as const;
export const JOB_I18N_KEYS = [
  "tasks.usageRefresh",
  "tasks.skillsRefresh",
  "tasks.sessionsRefresh",
  "tasks.retentionApply",
  "tasks.reportsGenerate",
] as const;

export type JobExecutorKey = (typeof JOB_EXECUTOR_KEYS)[number];

const taskId = z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
const i18nKey = z.enum(JOB_I18N_KEYS);
const schedule = z
  .object({
    kind: z.enum(["interval", "daily", "weekly"]),
    minutes: z.number().int().positive().optional(),
    localTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    weekday: z.number().int().min(1).max(7).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "interval" && value.minutes === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "interval requires minutes",
      });
    if (
      (value.kind === "daily" || value.kind === "weekly") &&
      value.localTime === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.kind} requires localTime`,
      });
    if (value.kind !== "weekly" && value.weekday !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weekday only applies to weekly",
      });
    if (value.kind !== "interval" && value.minutes !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minutes only applies to interval",
      });
    if (value.kind !== "weekly" && value.weekday !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weekday only applies to weekly",
      });
  });

const constraints = z
  .object({
    minMinutes: z.number().int().min(1).max(10080),
    maxMinutes: z.number().int().min(1).max(10080),
    singleFlight: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.minMinutes > value.maxMinutes)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minMinutes must not exceed maxMinutes",
      });
  });

const retry = z
  .object({
    maxAttempts: z.number().int().min(0).max(5),
    backoffSeconds: z.array(z.number().int().positive().max(86400)).max(5),
  })
  .strict();

export const JobTypeDefinitionSchema = z
  .object({
    id: taskId,
    executorKey: z.enum(JOB_EXECUTOR_KEYS),
    category: z.enum(["collection", "maintenance", "report"]),
    defaultSchedule: schedule,
    constraints,
    startupPolicy: z.enum(["disabled", "always", "if-stale"]),
    retry,
    timeoutMs: z.number().int().min(1000).max(86_400_000),
    queue: z.enum(["interactive", "background", "maintenance"]),
    network: z.enum(["forbidden", "allowed"]),
    requiresApproval: z.boolean(),
    ui: z.object({ settingsVisible: z.boolean(), i18nKey }).strict(),
  })
  .strict();

export const JobCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    tasks: z.array(JobTypeDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    for (const task of catalog.tasks) {
      if (ids.has(task.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks"],
          message: `duplicate task id: ${task.id}`,
        });
      ids.add(task.id);
      if (task.defaultSchedule.kind === "interval") {
        const minutes = task.defaultSchedule.minutes!;
        if (
          minutes < task.constraints.minMinutes ||
          minutes > task.constraints.maxMinutes
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tasks"],
            message: `${task.id} default interval outside constraints`,
          });
      }
    }
  });

export type JobTypeDefinition = z.infer<typeof JobTypeDefinitionSchema>;
export type JobCatalog = z.infer<typeof JobCatalogSchema>;

// Reject fields that could turn a static catalog into an execution/configuration channel.
export function assertSafeStaticCatalog(value: unknown): void {
  const forbiddenKey =
    /(?:command|path|url|script|code|module|import|dynamic|shell)/i;
  const forbiddenValue =
    /(?:https?:\/\/|(?:^|[\\/])(?:Users|home|tmp|AppData|Library|ProgramData)(?:[\\/]|$)|\b(?:rm|powershell|cmd|bash|sh|node)\b|=>|function\s*\(|<script)/i;
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node))
      return node.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && forbiddenValue.test(node))
        throw new Error(`unsafe catalog value at ${path}`);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (forbiddenKey.test(key))
        throw new Error(`forbidden catalog key at ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "$");
}
