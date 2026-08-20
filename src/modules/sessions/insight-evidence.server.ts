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
  const recoverable = metricValue(bundle, "chats.recoverable");
  const topSource = bundle.evidence.find(
    (item) => item.id === "chats.topSource" && typeof item.value === "string",
  );
  const candidates: InsightCandidate[] = [];

  if (total != null && total > 0) {
    candidates.push({
      id: "chats.total",
      severity: "info",
      factKey: "insights.page.chats.chats-total",
      factParams: { count: total },
      evidenceRefs: ["chats.total"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
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
    if (recoverable != null && recoverable > 0) {
      candidates.push({
        id: "chats.recoverable",
        severity: "info",
        factKey: "insights.page.chats.chats-recoverable",
        factParams: { count: recoverable },
        evidenceRefs: ["chats.recoverable"],
        allowedActionIds: ["open_sessions", "open_distill"],
        actionId: "open_sessions",
      });
    }
    candidates.push({
      id: "chats.resume",
      severity: "info",
      factKey: "insights.page.chats.chats-resume",
      factParams: {},
      evidenceRefs: ["chats.total"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
    candidates.push({
      id: "chats.distill",
      severity: "info",
      factKey: "insights.page.chats.chats-distill",
      factParams: {},
      evidenceRefs: ["chats.recoverable"],
      allowedActionIds: ["open_distill"],
      actionId: "open_distill",
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      id: "chats.empty",
      severity: "info",
      factKey: "insights.page.chats.chats-empty",
      factParams: {},
      evidenceRefs: [],
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
    (item) => item.id === "chat-detail.recoverable" && item.value === true,
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

  if (recoverable != null) {
    candidates.push({
      id: "chat-detail.recoverable",
      severity: "info",
      factKey: "insights.page.chat-detail.chat-detail-recoverable",
      factParams: {},
      evidenceRefs: ["chat-detail.recoverable"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
    candidates.push({
      id: "chat-detail.resume",
      severity: "info",
      factKey: "insights.page.chat-detail.chat-detail-resume",
      factParams: {},
      evidenceRefs: ["chat-detail.recoverable"],
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
    ],
  };
}

export const chatsInsightAdapter: PageInsightAdapter = {
  surfaceId: "chats",
  adapterVersion: 1,
  loadEvidence: loadChatsEvidence,
  composeCandidates: composeChatsCandidates,
};

export const chatDetailInsightAdapter: PageInsightAdapter = {
  surfaceId: "chat-detail",
  adapterVersion: 1,
  loadEvidence: loadChatDetailEvidence,
  composeCandidates: composeChatDetailCandidates,
};
