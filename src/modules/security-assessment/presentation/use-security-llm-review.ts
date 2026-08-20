import { useCallback, useEffect, useState } from "react";

import {
  buildSecurityLlmReviewAggregate,
  type SecurityLlmReview,
  type SecurityLlmReviewAvailability,
} from "../llm-review.contracts";
import {
  getSecurityLlmReview,
  getSecurityLlmReviewAvailability,
} from "../llm-review.server-fns";
import type { SecurityHistoryView } from "./security-view";

export interface SecurityLlmReviewState {
  readonly availability: SecurityLlmReviewAvailability | null;
  readonly review: SecurityLlmReview | null;
  readonly loading: boolean;
  readonly degraded: boolean;
  /** True only when a model is configured, the toggle is on and a report exists. */
  readonly canRequest: boolean;
  readonly request: () => void;
}

/**
 * Optional, user-triggered LLM supplement for a single report. Availability is
 * checked server-side (no model call); `request()` builds the sanitized
 * aggregate locally and posts it. Any failure degrades silently and keeps the
 * static report intact.
 */
export function useSecurityLlmReview(
  entry: SecurityHistoryView,
): SecurityLlmReviewState {
  const [availability, setAvailability] =
    useState<SecurityLlmReviewAvailability | null>(null);
  const [review, setReview] = useState<SecurityLlmReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    let disposed = false;
    getSecurityLlmReviewAvailability()
      .then((next) => {
        if (!disposed) setAvailability(next);
      })
      .catch(() => {
        if (!disposed) setAvailability({ configured: false, enabled: false });
      });
    return () => {
      disposed = true;
    };
  }, []);

  const canRequest = Boolean(
    entry.report &&
    availability?.configured === true &&
    availability?.enabled === true,
  );

  const request = useCallback(() => {
    const report = entry.report;
    if (report == null || loading) return;
    setLoading(true);
    setDegraded(false);
    const aggregate = buildSecurityLlmReviewAggregate({
      verdict: report.verdict,
      rulesVersion: report.rulesVersion,
      findings: report.findings,
    });
    void getSecurityLlmReview({
      data: {
        assetRef: report.contentHash ?? entry.scanId,
        aggregate,
      },
    })
      .then((result) => {
        if (result.status === "reviewed" && result.review != null) {
          setReview(result.review);
        } else {
          setDegraded(true);
        }
      })
      .catch(() => setDegraded(true))
      .finally(() => setLoading(false));
  }, [entry, loading]);

  return { availability, review, loading, degraded, canRequest, request };
}
