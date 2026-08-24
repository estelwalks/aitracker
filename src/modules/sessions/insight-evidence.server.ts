/**
 * Page-insight evidence adapters for the `chats` and `chat-detail` surfaces.
 *
 * Evidence sources (O(1) snapshot read — metadata only, never transcripts):
 *  - unified Session snapshot: total sessions, distinct sources, recoverable
 *  - `chat-detail` narrows the same snapshot to `scope.entityId` (a session id)
 *
 * Fact keys are the canonical `insights.page.chats.*` /
 * `insights.page.chat-detail.*` vocabulary declared by `PAGE_RULE_IDS` (M1).
 */
import {
  assertEntityId,
  emptyBundle,
  freshnessOf,
  metricEvidence,
  metricValue,
  statusEvidence,
} from "../../app/insights/evidence-util.server.ts";
import type {
  InsightCandidate,
  InsightEvidenceBundle,
  InsightScope,
  PageInsightAdapter,
} from "../insights/page/contracts.ts";

function isRecoverable(status: string): boolean {
  return status === "available" || status === "interrupted";
}

function composeChatsCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const total = metricValue(bundle, "chats.total");
  const sources = metricValue(bundle, "chats.sources");
  const recoverable = metricValue(bundle, "chats.recoverable");
  const turns = metricValue(bundle, "chats.turns");
  const tokens = metricValue(bundle, "chats.tokens");
  const durationMinutes = metricValue(bundle, "chats.durationMinutes");
  const topSource = bundle.evidence.find(
    (item) => item.id === "chats.topSource" && typeof item.value === "string",
  );
  const candidates: InsightCandidate[] = [];

  if (total != null) {
    candidates.push({
      id: "chats.inventory",
      severity: "info",
      factKey: "insights.page.chats.chats-guide-inventory",
      factParams: { count: total },
      evidenceRefs: ["chats.total"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
    if (sources != null) {
      candidates.push({
        id: "chats.sources",
        severity: "info",
        factKey: "insights.page.chats.chats-guide-sources",
        factParams: { count: sources },
        evidenceRefs: ["chats.sources"],
        allowedActionIds: ["open_sessions"],
        actionId: "open_sessions",
      });
    }
    if (topSource != null) {
      candidates.push({
        id: "chats.top-source",
        severity: "info",
        factKey: "insights.page.chats.chats-top-source",
        factParams: { name: String(topSource.value) },
        evidenceRefs: ["chats.topSource"],
        allowedActionIds: ["open_sessions"],
        actionId: "open_sessions",
      });
    }
    if (recoverable != null) {
      candidates.push({
        id: "chats.recoverable",
        severity: recoverable > 0 ? "attention" : "info",
        factKey: "insights.page.chats.chats-guide-recovery",
        factParams: { count: recoverable },
        evidenceRefs: ["chats.recoverable"],
        allowedActionIds: ["open_sessions", "open_distill"],
        actionId: "open_sessions",
      });
    }
  }
  if (turns != null && tokens != null) {
    candidates.push({
      id: "chats.activity",
      severity: "info",
      factKey: "insights.page.chats.chats-guide-activity",
      factParams: { turns, tokens },
      evidenceRefs: ["chats.turns", "chats.tokens"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }
  if (durationMinutes != null) {
    candidates.push({
      id: "chats.duration",
      severity: "info",
      factKey: "insights.page.chats.chats-guide-distill",
      factParams: { minutes: durationMinutes },
      evidenceRefs: ["chats.durationMinutes"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }
  return candidates;
}

async function loadChatsEvidence(scope: InsightScope) {
  assertEntityId(scope.entityId);
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { sessionSnapshot } = await getCompositionRoot();
  await sessionSnapshot.ensureHydrated();
  const latest = sessionSnapshot.readLatest();
  const snapshot = latest.data;

  if (snapshot == null) {
    return emptyBundle("chats", scope, observedAt, true);
  }

  const freshness = freshnessOf(snapshot.generatedAt, nowMs);
  const sessions = snapshot.sessions;
  const sources = new Set(sessions.map((session) => session.source)).size;
  const recoverable = sessions.filter((session) =>
    isRecoverable(session.status),
  ).length;
  const turns = sessions.reduce((sum, session) => sum + session.turns, 0);
  const tokens = sessions.reduce(
    (sum, session) => sum + session.totals.totalTokens,
    0,
  );
  const durationMinutes = Math.round(
    sessions.reduce((sum, session) => sum + session.durationMs, 0) / 60_000,
  );

  const bySource = new Map<string, number>();
  for (const session of sessions) {
    bySource.set(session.source, (bySource.get(session.source) ?? 0) + 1);
  }
  const topSource = [...bySource.entries()].reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    ["", -1] as [string, number],
  )[0];

  const evidence = [
    metricEvidence(
      "chats.total",
      sessions.length,
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence("chats.sources", sources, observedAt, freshness, "count"),
    metricEvidence(
      "chats.recoverable",
      recoverable,
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence("chats.turns", turns, observedAt, freshness, "count"),
    metricEvidence("chats.tokens", tokens, observedAt, freshness, "tokens"),
    metricEvidence(
      "chats.durationMinutes",
      durationMinutes,
      observedAt,
      freshness,
      "count",
    ),
  ];
  if (topSource !== "") {
    evidence.push(
      statusEvidence("chats.topSource", topSource, observedAt, freshness),
    );
  }

  return {
    surfaceId: "chats" as const,
    scope,
    observedAt,
    evidence,
  };
}

function composeChatDetailCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const turns = metricValue(bundle, "chat-detail.turns");
  const tokens = metricValue(bundle, "chat-detail.tokens");
  const recoverable = bundle.evidence.find(
    (item) => item.id === "chat-detail.recoverable",
  );
  const durationMinutes = metricValue(bundle, "chat-detail.durationMinutes");
  const editTurns = metricValue(bundle, "chat-detail.editTurns");
  const retryTurns = metricValue(bundle, "chat-detail.retryTurns");
  const subagentCalls = metricValue(bundle, "chat-detail.subagentCalls");
  const source = bundle.evidence.find(
    (item) =>
      item.id === "chat-detail.source" && typeof item.value === "string",
  );
  const status = bundle.evidence.find(
    (item) =>
      item.id === "chat-detail.status" && typeof item.value === "string",
  );
  const candidates: InsightCandidate[] = [];

  if (turns != null) {
    candidates.push({
      id: "chat-detail.turns",
      severity: "info",
      factKey: "insights.page.chat-detail.chat-detail-turns",
      factParams: { count: turns },
      evidenceRefs: ["chat-detail.turns"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }

  if (tokens != null && tokens > 0) {
    candidates.push({
      id: "chat-detail.tokens",
      severity: "info",
      factKey: "insights.page.chat-detail.chat-detail-tokens",
      factParams: { tokens },
      evidenceRefs: ["chat-detail.tokens"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }

  if (source != null && status != null) {
    candidates.push({
      id: "chat-detail.state",
      severity: "info",
      factKey: "insights.page.chat-detail.chat-detail-guide-state",
      factParams: {
        source: String(source.value),
        status: String(status.value),
      },
      evidenceRefs: ["chat-detail.source", "chat-detail.status"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }
  if (recoverable?.value === true) {
    candidates.push({
      id: "chat-detail.recoverable",
      severity: "info",
      factKey: "insights.page.chat-detail.chat-detail-recoverable",
      factParams: {},
      evidenceRefs: ["chat-detail.recoverable"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }

  for (const [id, value, key, ref, param] of [
    [
      "duration",
      durationMinutes,
      "chat-detail-guide-distill",
      "chat-detail.durationMinutes",
      "minutes",
    ],
    [
      "edits",
      editTurns,
      "chat-detail-guide-recovery",
      "chat-detail.editTurns",
      "count",
    ],
    [
      "retries",
      retryTurns,
      "chat-detail-guide-turns",
      "chat-detail.retryTurns",
      "count",
    ],
    [
      "subagents",
      subagentCalls,
      "chat-detail-guide-tokens",
      "chat-detail.subagentCalls",
      "count",
    ],
  ] as const) {
    if (value == null) continue;
    candidates.push({
      id: `chat-detail.${id}`,
      severity: "info",
      factKey: `insights.page.chat-detail.${key}`,
      factParams: { [param]: value },
      evidenceRefs: [ref],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }

  return candidates;
}

async function loadChatDetailEvidence(scope: InsightScope) {
  assertEntityId(scope.entityId);
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { sessionSnapshot } = await getCompositionRoot();
  await sessionSnapshot.ensureHydrated();
  const latest = sessionSnapshot.readLatest();
  const snapshot = latest.data;

  if (snapshot == null) {
    return emptyBundle("chat-detail", scope, observedAt, true);
  }

  const entityId = scope.entityId;
  if (entityId == null) {
    return emptyBundle("chat-detail", scope, observedAt, true);
  }

  const matches = snapshot.sessions.filter(
    (session) => session.sessionId === entityId,
  );
  if (matches.length === 0) {
    return emptyBundle("chat-detail", scope, observedAt, true);
  }

  const freshness = freshnessOf(snapshot.generatedAt, nowMs);
  const turns = matches.reduce((sum, session) => sum + session.turns, 0);
  const tokens = matches.reduce(
    (sum, session) => sum + session.totals.totalTokens,
    0,
  );
  const recoverable = matches.some((session) => isRecoverable(session.status));
  const durationMinutes = Math.round(
    matches.reduce((sum, session) => sum + session.durationMs, 0) / 60_000,
  );
  const editTurns = matches.reduce(
    (sum, session) => sum + session.editTurns,
    0,
  );
  const retryTurns = matches.reduce(
    (sum, session) => sum + session.retryTurns,
    0,
  );
  const subagentCalls = matches.reduce(
    (sum, session) => sum + session.subagentCalls,
    0,
  );

  return {
    surfaceId: "chat-detail" as const,
    scope,
    observedAt,
    evidence: [
      metricEvidence(
        "chat-detail.turns",
        turns,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence(
        "chat-detail.tokens",
        tokens,
        observedAt,
        freshness,
        "tokens",
      ),
      {
        id: "chat-detail.recoverable",
        kind: "availability" as const,
        value: recoverable,
        observedAt,
        freshness,
        sensitivity: "aggregate" as const,
      },
      metricEvidence(
        "chat-detail.durationMinutes",
        durationMinutes,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence(
        "chat-detail.editTurns",
        editTurns,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence(
        "chat-detail.retryTurns",
        retryTurns,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence(
        "chat-detail.subagentCalls",
        subagentCalls,
        observedAt,
        freshness,
        "count",
      ),
      statusEvidence(
        "chat-detail.source",
        matches[0]!.source,
        observedAt,
        freshness,
      ),
      statusEvidence(
        "chat-detail.status",
        matches[0]!.status,
        observedAt,
        freshness,
      ),
    ],
  };
}

export const chatsInsightAdapter: PageInsightAdapter = {
  surfaceId: "chats",
  adapterVersion: 3,
  loadEvidence: loadChatsEvidence,
  composeCandidates: composeChatsCandidates,
};

export const chatDetailInsightAdapter: PageInsightAdapter = {
  surfaceId: "chat-detail",
  adapterVersion: 3,
  loadEvidence: loadChatDetailEvidence,
  composeCandidates: composeChatDetailCandidates,
};
