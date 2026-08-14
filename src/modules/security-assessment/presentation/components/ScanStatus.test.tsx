import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EMPTY_SECURITY_PROGRESS,
  EMPTY_SECURITY_TOTALS,
  SECURITY_RISK_KINDS,
  type SecurityRuntimeCapabilityView,
  type SecurityScanStateView,
} from "../security-view.ts";
import { ScanStatus } from "./ScanStatus.tsx";

const IDLE: SecurityScanStateView = {
  scanId: null,
  status: "idle",
  mode: null,
  trigger: null,
  locale: null,
  progress: EMPTY_SECURITY_PROGRESS,
  resultIds: [],
};

const DETECTION_ONLY: SecurityRuntimeCapabilityView = {
  activeDefense: false,
  capability: "detection-only",
  monitorAvailable: true,
  evidence: "local-static-and-model-analysis",
  cancellation: "between-skills",
  riskKinds: SECURITY_RISK_KINDS,
};

test("ScanStatus renders the real detection-only status, never a running label when idle", () => {
  const markup = renderToStaticMarkup(
    <ScanStatus
      state={IDLE}
      totals={EMPTY_SECURITY_TOTALS}
      scanCount={3}
      dimensions={11}
      latestFinishedAt={null}
      runtime={DETECTION_ONLY}
      riskKinds={SECURITY_RISK_KINDS}
      onGo={() => {}}
    />,
  );
  assert.match(markup, /全局安全统计/);
  assert.match(markup, /已扫描 Skill/);
  assert.match(markup, /累计扫描/);
  assert.match(markup, /仅检测模式/);
  assert.doesNotMatch(markup, /扫描进行中/);
});

test("ScanStatus shows the running phase label while a scan is active", () => {
  const running: SecurityScanStateView = {
    ...IDLE,
    status: "running",
    progress: {
      ...EMPTY_SECURITY_PROGRESS,
      queued: 10,
      percent: 42,
    },
  };
  const markup = renderToStaticMarkup(
    <ScanStatus
      state={running}
      totals={EMPTY_SECURITY_TOTALS}
      scanCount={3}
      dimensions={11}
      latestFinishedAt={null}
      runtime={null}
      riskKinds={SECURITY_RISK_KINDS}
      onGo={() => {}}
    />,
  );
  assert.match(markup, /扫描进行中/);
});
