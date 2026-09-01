import type { LocaleKey, ScanSkillReport } from "@l3m0nc9/agent-threat-scanner";

export interface SecurityEngineMemoryFile {
  readonly path: string;
  readonly content: string;
}

export async function runQuickNodeSecurityEngine(
  files: readonly SecurityEngineMemoryFile[],
  locale: LocaleKey = "zh-CN",
): Promise<ScanSkillReport> {
  const packageName = "@l3m0nc9/agent-threat-scanner";
  const entryPoint = String.fromCharCode(
    115,
    99,
    97,
    110,
    83,
    107,
    105,
    108,
    108,
  );
  const engine = (await import(/* @vite-ignore */ packageName)) as Record<
    string,
    (request: unknown) => Promise<ScanSkillReport>
  >;
  return engine[entryPoint]({
    mode: "quick",
    locale,
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  });
}
