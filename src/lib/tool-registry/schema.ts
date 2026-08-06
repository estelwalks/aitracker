/**
 * Zod schemas for the v1.5 JSON world (docs §5/§6).
 *
 * `RawToolDefinition` is the strict shape of `definitions/*.tool.json`:
 * platform-aware (`platforms`/`locations`/`rootSpecs`), referencing rule packs
 * instead of embedding rates. The loader compiles raw definitions into the
 * runtime `ToolDefinition` (contracts.ts), projecting the flattened fields the
 * legacy consumers still read (Phase 4 switches them to the new APIs).
 *
 * JSON is data, never code: no functions, no env interpolation, no arbitrary
 * commands. Cross-field rules are enforced here at build time (the generated
 * module embeds the validated raw definitions).
 */
import { z } from "zod";
import { isUnsafePath } from "./validate.ts";

export const PlatformTargetSchema = z.enum([
  "macos",
  "windows10",
  "windows11",
  "linux",
]);

export const PlatformStatusSchema = z.enum([
  "supported",
  "planned",
  "unsupported",
]);

/** Enumerated path bases (docs §6.1) + the open `env:NAME` arm. */
export const PathBaseSchema = z.union([
  z.enum([
    "home",
    "userProfile",
    "appData",
    "appDataRoaming",
    "configHome",
    "dataHome",
  ]),
  z.string().regex(/^env:[A-Z][A-Z0-9_]*$/, {
    message: "env base must be `env:NAME` with an uppercase NAME",
  }),
]);

export const UsageFormatSchema = z.enum(["json", "jsonl", "sqlite"]);

const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const MAX_PATH_LENGTH = 512;

/** D9: sqlite queries are data - reject write/attach semantics at build time. */
const UNSAFE_SQL_KEYWORDS = /\b(ATTACH|DROP|INSERT|UPDATE|DELETE|PRAGMA)\b/iu;

/** A path that still resolves inside its base after joining is required. */
function assertSafeRelativePath(
  path: string,
  ctx: z.RefinementCtx,
  what: string,
): void {
  if (isUnsafePath(path) || path.length > MAX_PATH_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [what],
      message: `${what} "${path}" is unsafe (no absolute/../NUL paths, max ${MAX_PATH_LENGTH} chars)`,
    });
  }
}

export const DetectionLocationSchema = z
  .object({
    targets: z.array(PlatformTargetSchema).min(1),
    base: PathBaseSchema,
    path: z.string().min(1),
    glob: z.string().min(1).optional(),
  })
  .superRefine((loc, ctx) => {
    assertSafeRelativePath(loc.path, ctx, "detection.locations.path");
    if (loc.glob?.includes("\0")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detection.locations.glob"],
        message: "glob must not contain NUL",
      });
    }
  });

export const ExecutableSchema = z
  .object({
    shared: z.array(z.string().min(1)).optional(),
    windows: z.array(z.string().min(1)).optional(),
  })
  .superRefine((exe, ctx) => {
    for (const [key, list] of Object.entries(exe)) {
      for (const name of list ?? []) {
        if (name.includes("\0")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [`executable.${key}`],
            message: `executable name must not contain NUL`,
          });
        }
      }
    }
  });

export const ToolPlatformsSchema = z
  .object({
    macos: PlatformStatusSchema,
    windows: PlatformStatusSchema.optional(),
    windows10: PlatformStatusSchema.optional(),
    windows11: PlatformStatusSchema.optional(),
    linux: PlatformStatusSchema,
  })
  .superRefine((platforms, ctx) => {
    // windows group + exact override at the same level is ambiguous (docs §5:
    // same-level duplicate definition fails the build).
    if (
      platforms.windows !== undefined &&
      (platforms.windows10 !== undefined || platforms.windows11 !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platforms"],
        message:
          "windows group status must not coexist with windows10/windows11 overrides at tool level (override belongs to _shared platform-profiles)",
      });
    }
  });

export const RawUsagePathSchema = z
  .object({
    targets: z.array(PlatformTargetSchema).min(1),
    base: PathBaseSchema,
    path: z.string().min(1),
    glob: z.string().min(1),
    format: UsageFormatSchema,
  })
  .superRefine((p, ctx) => {
    assertSafeRelativePath(p.path, ctx, "usage.paths.path");
    if (p.glob.includes("\0")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["usage.paths.glob"],
        message: "glob must not contain NUL",
      });
    }
  });

export const RawUsageMappingSchema = z
  .object({
    records: z.array(z.string().min(1)).optional(),
    timestamp: z.array(z.string().min(1)).optional(),
    sessionId: z.array(z.string().min(1)).optional(),
    model: z.array(z.string().min(1)).optional(),
    project: z.array(z.string().min(1)).optional(),
    inputTokens: z.array(z.string().min(1)).optional(),
    cachedInputTokens: z.array(z.string().min(1)).optional(),
    cacheCreationInputTokens: z.array(z.string().min(1)).optional(),
    outputTokens: z.array(z.string().min(1)).optional(),
    reasoningOutputTokens: z.array(z.string().min(1)).optional(),
    totalTokens: z.array(z.string().min(1)).optional(),
  })
  .superRefine((mapping, ctx) => {
    for (const [key, candidates] of Object.entries(mapping)) {
      if (candidates.some((c) => c.includes("\0"))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`usage.mapping.${key}`],
          message: "mapping keys must not contain NUL",
        });
      }
    }
  });

const UsageCapabilitySchema = z
  .object({
    mode: z.enum(["native", "adapter", "unsupported"]),
    reader: z.string().min(1).optional(),
    paths: z.array(RawUsagePathSchema).optional(),
    mapping: RawUsageMappingSchema.optional(),
    maxFileSizeBytes: z.number().int().positive().optional(),
    /** D9: sqlite queries are data; write/attach semantics rejected here. */
    query: z.string().optional(),
  })
  .superRefine((usage, ctx) => {
    if (usage.mode === "unsupported") {
      if (usage.reader !== undefined || usage.paths !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["usage"],
          message: "usage.mode=unsupported must not declare reader or paths",
        });
      }
    } else {
      if (usage.reader === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["usage.reader"],
          message: `usage.mode=${usage.mode} requires a reader key`,
        });
      }
      if (!usage.paths || usage.paths.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["usage.paths"],
          message: `usage.mode=${usage.mode} requires at least one path`,
        });
      }
    }
    if (usage.query !== undefined) {
      const q = usage.query.trim();
      if (
        !q.startsWith("SELECT") ||
        q.includes(";") ||
        UNSAFE_SQL_KEYWORDS.test(q)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["usage.query"],
          message:
            "query must be a single read-only SELECT (no ; or ATTACH/DROP/INSERT/UPDATE/DELETE/PRAGMA)",
        });
      }
    }
  });

const SessionsCapabilitySchema = z
  .object({
    mode: z.enum(["resume", "unsupported"]),
    reader: z.string().min(1).optional(),
    /** Resume command as a token array; must contain exactly the {sessionId} placeholder. */
    command: z.array(z.string().min(1)).optional(),
  })
  .superRefine((sessions, ctx) => {
    if (sessions.mode === "resume") {
      if (sessions.reader === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions.reader"],
          message: "sessions.mode=resume requires a reader key",
        });
      }
      if (!sessions.command || sessions.command.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions.command"],
          message: "sessions.mode=resume requires a command template",
        });
      } else {
        const placeholders = sessions.command.filter((t) =>
          t.includes("{sessionId}"),
        );
        if (placeholders.length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sessions.command"],
            message:
              "sessions.command must contain exactly one {sessionId} token",
          });
        }
        if (sessions.command.some((t) => t.includes("\0"))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sessions.command"],
            message: "session command tokens must not contain NUL",
          });
        }
      }
    } else if (
      sessions.reader !== undefined ||
      sessions.command !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions"],
        message: "sessions.mode=unsupported must not declare reader or command",
      });
    }
  });

const ContextCapabilitySchema = z
  .object({
    mode: z.enum(["native", "heuristic", "unsupported"]),
    reader: z.string().min(1).optional(),
    dimensions: z.array(z.string().min(1)).optional(),
  })
  .superRefine((context, ctx) => {
    if (context.mode === "native" && context.reader === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["context.reader"],
        message: "context.mode=native requires a reader key",
      });
    }
    if (context.mode === "heuristic" && !context.dimensions?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["context.dimensions"],
        message: "context.mode=heuristic requires dimensions",
      });
    }
    if (
      context.mode === "unsupported" &&
      (context.reader !== undefined || context.dimensions !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["context"],
        message:
          "context.mode=unsupported must not declare reader or dimensions",
      });
    }
  });

export const RawSkillRootSchema = z
  .object({
    base: PathBaseSchema,
    path: z.string().min(1),
  })
  .superRefine((root, ctx) => {
    assertSafeRelativePath(root.path, ctx, "storage.skills.rootSpecs.path");
  });

const SkillsCapabilitySchema = z.enum(["read-write", "read", "unsupported"]);
const AgentsCapabilitySchema = z.enum(["read", "unsupported"]);
const MarketCapabilitySchema = z.enum(["install-target", "unsupported"]);
const SecurityCapabilitySchema = z.enum(["scan", "unsupported"]);

export const RawPricingSchema = z
  .object({
    provider: z.string().min(1).optional(),
    billingMode: z.enum(["api-metered", "subscription", "unsupported"]),
    fallbackProfileRef: z.string().min(1),
    rulePackRefs: z.array(z.string().min(1)).default([]),
  })
  .superRefine((pricing, ctx) => {
    if (
      pricing.billingMode === "unsupported" &&
      pricing.rulePackRefs.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pricing.rulePackRefs"],
        message: "billingMode=unsupported must not reference rule packs",
      });
    }
  });

/**
 * Strict v1.5 tool definition (the JSON world). `catalogVisible=false` is only
 * allowed for the legacy collection sources aipy/cline (docs §6).
 */
export const RawToolDefinitionSchema = z
  .object({
    $schema: z.string().optional(),
    configVersion: z.literal(1),
    id: z.string().regex(TOOL_ID_PATTERN, {
      message: "id must be kebab-case (lowercase, start with a letter)",
    }),
    catalogVisible: z.boolean().optional(),
    display: z.object({
      name: z.string().min(1),
      nameZh: z.string().min(1),
      icon: z.string().min(1).optional(),
    }),
    platforms: ToolPlatformsSchema,
    detection: z
      .object({
        locations: z.array(DetectionLocationSchema).min(1),
        executable: ExecutableSchema.optional(),
      })
      .superRefine((detection, ctx) => {
        // Same-level duplicate = the exact same location declared twice.
        // Distinct paths may legitimately cover the same target (a platform can
        // have several probe roots); only identical declarations fail.
        const seen = new Set<string>();
        for (const loc of detection.locations) {
          const key = JSON.stringify({
            targets: [...loc.targets].sort(),
            base: loc.base,
            path: loc.path,
          });
          if (seen.has(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["detection.locations"],
              message: `duplicate detection location (same targets/base/path) fails the build`,
            });
          }
          seen.add(key);
        }
      }),
    storage: z
      .object({
        dataRoots: z
          .array(
            z
              .object({ base: PathBaseSchema, path: z.string().min(1) })
              .superRefine((r, c) =>
                assertSafeRelativePath(r.path, c, "storage.dataRoots.path"),
              ),
          )
          .optional(),
        skills: z
          .object({
            rootSpecs: z.array(RawSkillRootSchema).optional(),
            envHome: z
              .string()
              .regex(ENV_VAR_PATTERN, {
                message: "envHome must be a valid env var name",
              })
              .optional(),
            markers: z.array(z.string().min(1)).optional(),
            maxDepth: z.number().int().positive().optional(),
          })
          .optional(),
        agents: z
          .object({
            mode: AgentsCapabilitySchema,
            roots: z.array(z.string().min(1)).optional(),
          })
          .optional(),
      })
      .optional()
      .superRefine((storage, ctx) => {
        for (const root of storage?.skills?.rootSpecs ?? []) {
          assertSafeRelativePath(
            root.path,
            ctx,
            "storage.skills.rootSpecs.path",
          );
        }
      }),
    capabilities: z
      .object({
        usage: UsageCapabilitySchema,
        context: ContextCapabilitySchema.optional(),
        skills: SkillsCapabilitySchema,
        agents: AgentsCapabilitySchema,
        sessions: SessionsCapabilitySchema,
        market: MarketCapabilitySchema,
        security: SecurityCapabilitySchema,
      })
      .superRefine((caps, ctx) => {
        // Market install-target requires writable skills; the storage-level
        // half of this rule is enforced on the outer schema.
        if (caps.market === "install-target" && caps.skills !== "read-write") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["capabilities.market"],
            message:
              "market.mode=install-target requires skills.mode=read-write",
          });
        }
      }),
    pricing: RawPricingSchema.optional(),
  })
  .superRefine((raw, ctx) => {
    // catalogVisible=false is only for the legacy collection sources (docs §6).
    if (
      raw.catalogVisible === false &&
      raw.id !== "aipy" &&
      raw.id !== "cline"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["catalogVisible"],
        message: `catalogVisible=false is only allowed for legacy sources (aipy/cline), got "${raw.id}"`,
      });
    }
    // market install-target also needs skill root storage.
    if (
      raw.capabilities.market === "install-target" &&
      !raw.storage?.skills?.rootSpecs?.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storage.skills.rootSpecs"],
        message: "market.mode=install-target requires storage.skills.rootSpecs",
      });
    }
  });

export type RawToolDefinition = z.infer<typeof RawToolDefinitionSchema>;
export type RawUsagePath = z.infer<typeof RawUsagePathSchema>;

// ---------------------------------------------------------------------------
// Shared policy packs (docs §6.2): each pack configures facts, never
// implementation. The loader/registry consume these after build-time parsing.
// ---------------------------------------------------------------------------

export const PlatformProfilesSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  targets: z.array(PlatformTargetSchema).min(1),
  groups: z.object({
    windows: z.array(z.enum(["windows10", "windows11"])).length(2),
  }),
  basePlatforms: z.record(PathBaseSchema, z.array(PlatformTargetSchema).min(1)),
  xdgFallback: z.record(z.string().min(1), z.string().min(1)),
  defaultStatus: z.object({
    macos: PlatformStatusSchema,
    windows: PlatformStatusSchema,
    linux: PlatformStatusSchema,
  }),
});

export const GenericReaderDefaultsSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  defaultMapping: RawUsageMappingSchema,
  defaultMaxFileSizeBytes: z.number().int().positive(),
});

export const ScannerPolicySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  lookbackDays: z.number().int().positive(),
  maxFilesPerSource: z.number().int().positive(),
  maxDiscoveredEntriesPerSource: z.number().int().positive(),
  maxJsonlLineLength: z.number().int().positive(),
  futureTimestampToleranceMs: z.number().int().positive(),
  cacheFileName: z.string().min(1),
  cacheNote: z.string().optional(),
});

export const SkillMarketPolicySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  skillAgentOrder: z.array(z.string().regex(TOOL_ID_PATTERN)).min(1),
  defaultMarkers: z.array(z.string().min(1)).min(1),
  defaultMaxDepth: z.number().int().positive(),
  marketInstallCondition: z.object({
    requires: z.array(z.string().min(1)).min(1),
    note: z.string().optional(),
  }),
});

export const UsageTaxonomySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  debugCommandHints: z.array(z.string().min(1)).min(1),
  behaviorPriority: z.array(z.string().min(1)).min(1),
  contextDimensions: z.record(
    z.string().min(1),
    z.object({ i18nKey: z.string().min(1) }),
  ),
});

export const DefinitionsManifestSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  tools: z
    .array(
      z.object({
        id: z.string().regex(TOOL_ID_PATTERN),
        path: z.string().regex(/^[a-z0-9-]+\.tool\.json$/),
      }),
    )
    .min(1),
});

export const SharedPolicyPackSchema = z.object({
  platformProfiles: PlatformProfilesSchema,
  genericReaderDefaults: GenericReaderDefaultsSchema,
  scannerPolicy: ScannerPolicySchema,
  skillMarketPolicy: SkillMarketPolicySchema,
  usageTaxonomy: UsageTaxonomySchema,
  definitionsManifest: DefinitionsManifestSchema,
});

export type SharedPolicyPacks = z.infer<typeof SharedPolicyPackSchema>;
