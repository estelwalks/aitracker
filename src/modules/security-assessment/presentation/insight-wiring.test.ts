import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const briefingSource = source(
  "src/modules/security-assessment/presentation/components/SecurityBriefing.tsx",
);
const securityPageSource = source(
  "src/modules/security-assessment/presentation/SecurityAssessmentPage.tsx",
);
const insightCardSource = source(
  "src/modules/insights/page/presentation/insight-card.tsx",
);
const sharedInsightSource = source("src/components/JarvisInsight.tsx");
const autoScanSource = source(
  "src/modules/security-assessment/presentation/components/AutoScanGuide.tsx",
);
const settingsScheduleSource = source(
  "src/modules/settings/presentation/ScanScheduleSection.tsx",
);

test("security briefing delegates copy and layout to the shared insight card", () => {
  assert.match(briefingSource, /InsightCard/);
  assert.match(briefingSource, /surfaceId=["']security["']/);
  assert.match(briefingSource, /fallbackLines={localLines}/);
  assert.match(briefingSource, /showFallbackStatus={false}/);
  assert.match(briefingSource, /actions=\{actions\}/);
  assert.match(briefingSource, /actionsLayout="title-row"/);
  assert.match(
    briefingSource,
    /flex shrink-0 flex-col items-center gap-1[\s\S]*?size-20 shrink-0[\s\S]*?security-briefing-scan/,
  );
  assert.match(briefingSource, /size-20 shrink-0/);
  assert.match(briefingSource, /aitracker-num text-\[18px\]/);
  assert.match(briefingSource, /const statusBar/);
});

test("security briefing inherits the AI-enhanced title label", () => {
  assert.match(insightCardSource, /source=\{envelope\?\.source\}/);
  assert.match(
    insightCardSource,
    /enhancedLabel=\{t\("settings\.insight\.enhanced"\)\}/,
  );
  assert.match(sharedInsightSource, /source === "enhanced"/);
  assert.ok(
    sharedInsightSource.indexOf("{enhancedMark}") <
      sharedInsightSource.indexOf("{actions == null"),
  );
});

test("security route keeps one bespoke briefing and does not add a second insight card", () => {
  assert.match(securityPageSource, /<SecurityBriefing/);
  assert.doesNotMatch(securityPageSource, /<InsightCard/);
});

test("security briefing remains visible when the scan client is unavailable", () => {
  assert.match(
    securityPageSource,
    /connection !== "connecting"[\s\S]*?<SecurityBriefing[\s\S]*?connection === "unavailable"/,
  );
});

test("security briefing stays above the scheduled-scan bar", () => {
  assert.ok(
    securityPageSource.indexOf("<SecurityBriefing") <
      securityPageSource.indexOf("<AutoScanGuide"),
  );
});

test("automatic schedule time reaches both security surfaces", () => {
  assert.match(
    securityPageSource,
    /<AutoScanGuide onNextScanAtChange=\{setNextScanAt\}/,
  );
  assert.match(autoScanSource, /resolveNextScheduledScanAt/);
  assert.match(settingsScheduleSource, /resolveNextScheduledScanAt/);
  assert.doesNotMatch(
    settingsScheduleSource,
    /scheduleStatus\?\.nextRunAt\s*\?\s*format/,
  );
});

test("zero pending items use the green safe icon", () => {
  assert.match(
    briefingSource,
    /pending === 0[\s\S]*?ShieldCheck[\s\S]*?text-ok/,
  );
});

test("automatic scan time inputs defer persistence until editing is complete", () => {
  for (const sourceText of [autoScanSource, settingsScheduleSource]) {
    assert.match(sourceText, /const \[timeDraft, setTimeDraft\]/);
    assert.match(
      sourceText,
      /type="time"[\s\S]*?value=\{timeDraft \?\? schedule\.time\}[\s\S]*?onChange=\{\(event\) => setTimeDraft\(event\.target\.value\)\}[\s\S]*?onBlur=/,
    );
  }
});

test("completed security scans invalidate and refresh the security insight", () => {
  assert.match(securityPageSource, /refreshPageInsightSurface/);
  assert.match(securityPageSource, /surfaceId: ["']security["']/);
  assert.match(
    securityPageSource,
    /next\.status === ["']complete["'][\s\S]*?next\.status === ["']partial["'][\s\S]*?refreshSecurityInsight/,
  );
  assert.match(securityPageSource, /PAGE_INSIGHT_REFRESH_EVENT/);
  assert.match(securityPageSource, /PAGE_INSIGHT_REFRESH_CHANNEL/);
});

test("all-skipped automatic runs still update the visible latest scan", () => {
  assert.match(securityPageSource, /setLatestRun\(scheduleStatus\.lastRun\)/);
  assert.match(
    securityPageSource,
    /latestRun\?\.finishedAt \?\? latestRun\?\.startedAt/,
  );
  assert.match(
    securityPageSource,
    /const scanCount = countScanTasks\(history\)/,
  );
  assert.match(securityPageSource, /latestFinishedAt=\{latestFinishedAt\}/);
});
