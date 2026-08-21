import { createServerFn } from "@tanstack/react-start";

import type {
  SourceMigrationInput,
  SourceMigrationResult,
} from "./migration.server.ts";

/**
 * Sources 一键迁移（Story B-300）——server fn 边界。
 *
 * validator 与 handler 都动态 import `*.server.ts`（校验与扫描逻辑只在
 * 服务端执行；TanStack Start 的 validator 仅在 `env === "server"` 时运行），
 * 浏览器 bundle 只保留 RPC 客户端引用，路径与扫描实现不进入前端。
 */
export const migrateSourceSkills = createServerFn({ method: "POST" })
  .validator(
    async (input: SourceMigrationInput): Promise<SourceMigrationInput> => {
      const { validateMigrationInput } = await import("./migration.server.ts");
      return validateMigrationInput(input);
    },
  )
  .handler(async ({ data }): Promise<SourceMigrationResult> => {
    const { migrateSourceSkills: runMigration } =
      await import("./migration.server.ts");
    const result = await runMigration(data);

    // The migration writes Skill directories directly. Queue the persisted
    // Skill read-model refresh without delaying the mutation response; the
    // Sources page polls the skill counts and updates when the task commits.
    if (result.migrated.length > 0 || result.skipped.length > 0) {
      const { getCompositionRoot } =
        await import("../../app/composition.server.ts");
      const root = await getCompositionRoot();
      void root.skillSnapshot
        .requestRefresh({ reason: "event" })
        .catch(() => {});
    }

    return result;
  });
