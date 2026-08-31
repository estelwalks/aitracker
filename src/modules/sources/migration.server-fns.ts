import { createServerFn } from "@tanstack/react-start";

import type {
  SourceMigrationInput,
  SourceMigrationResult,
} from "./migration.server.ts";

/**
 * Sources one-click migration (Story B-300) - server fn boundary.
 *
 * Both validator and handler dynamically import `*.server.ts` (the verification and scanning logic is only in
 * Server-side execution; TanStack Start's validator only runs when `env === "server"`),
 * The browser bundle only retains the RPC client reference, the path and scan implementation does not go into the front end.
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
