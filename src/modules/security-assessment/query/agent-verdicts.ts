import { createServerFn } from "@tanstack/react-start";

import type { SecurityVerdict } from "../presentation/security-view";

export interface SecuritySkillVerdictReadModel {
  readonly byName: Readonly<Record<string, SecurityVerdict>>;
  readonly legacyGeneric: {
    readonly safe: number;
    readonly total: number;
  };
}

/**
 * Browser-safe query boundary for the Agent overview. The actual preference
 * and scan-history read stays in the server-only security summary adapter.
 */
export const getSecuritySkillVerdicts = createServerFn({
  method: "GET",
}).handler(async (): Promise<SecuritySkillVerdictReadModel> => {
  const { getSecuritySkillVerdicts: readVerdicts } =
    await import("../../../app/security-summary.server.ts");
  return readVerdicts();
});
