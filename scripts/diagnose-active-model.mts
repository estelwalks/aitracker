#!/usr/bin/env node
/**
 * Safe active-model diagnostics. The two outbound prompts are fixed synthetic
 * fixtures; output contains no headers, prompt/response text, profile name,
 * endpoint path/query or decrypted secret.
 *
 * Usage: npm run diagnose:model -- [--timeout-ms <1..120000>]
 * Stop the local app first because the application database is single-writer.
 */
import { getCompositionRoot } from "../src/app/composition.server.ts";
import { diagnoseModelProfile } from "../src/modules/ai-orchestration/model-profile.server.ts";

const USAGE = "usage: npm run diagnose:model -- [--timeout-ms <1..120000>]";

function parseTimeoutMs(argv: readonly string[]): number | undefined {
  if (argv.length === 0) return undefined;
  if (argv.length !== 2 || argv[0] !== "--timeout-ms") {
    throw new RangeError(USAGE);
  }
  const timeoutMs = Number(argv[1]);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError(USAGE);
  }
  return timeoutMs;
}

async function main(): Promise<void> {
  let root: Awaited<ReturnType<typeof getCompositionRoot>> | undefined;
  try {
    const timeoutMs = parseTimeoutMs(process.argv.slice(2));
    root = await getCompositionRoot();
    const active = await root.modelProfiles.getActiveView();
    if (!active) {
      console.error("model-diagnostic: no-active-profile");
      process.exitCode = 1;
      return;
    }
    const profile = await root.modelProfiles.getProfileForExecution(active.id);
    if (!profile?.apiKey) {
      console.error("model-diagnostic: active-profile-secret-unavailable");
      process.exitCode = 1;
      return;
    }
    const report = await diagnoseModelProfile(profile, {
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.attempts.some((attempt) => attempt.classification !== "none")) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      error instanceof RangeError
        ? error.message
        : "model-diagnostic: unavailable (stop the app and verify local configuration)",
    );
    process.exitCode = 1;
  } finally {
    try {
      root?.database.close();
    } catch {
      console.error("model-diagnostic: database-close-failed");
      process.exitCode = 1;
    }
  }
}

await main();
