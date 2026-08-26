import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../../../lib/i18n/context";
import type {
  SecurityClient,
  SecurityScanCycle,
  SecurityScanScheduleView,
  SecurityScanScheduleStatusView,
  SecurityScanScope,
} from "../../security-assessment/index";
import {
  Field,
  SectionHeading,
  SecurityLoadError,
  SecurityUnavailable,
  Toggle,
} from "./fields";
import type { SecurityConnectionStatus } from "./use-security-client";

const CYCLE_OPTIONS: readonly SecurityScanCycle[] = [
  "hourly",
  "daily",
  "weekly",
];

const SCOPE_OPTIONS: readonly SecurityScanScope[] = ["all", "agent", "dir"];

const cycleKeys: Record<SecurityScanCycle, "hourly" | "daily" | "weekly"> = {
  hourly: "hourly",
  daily: "daily",
  weekly: "weekly",
};

const scopeKeys: Record<
  SecurityScanScope,
  "scopeAll" | "scopeAgent" | "scopeDir"
> = {
  all: "scopeAll",
  agent: "scopeAgent",
  dir: "scopeDir",
};

/**
 * 扫描配置：与 V3.0 原型对齐的 Field 行 + chip 风格。
 *
 * 定时扫描(Toggle) / 扫描周期(chip) / 扫描时间 / 扫描范围(全部/指定 Agent/指定目录)
 * / 告警通知(Toggle)。全部绑定真实 SecurityClient.getScanSchedule()/
 * setScanSchedule()，范围选择通过 schedule.agents / schedule.dir 持久化。
 */
export function ScanScheduleSection({
  client,
  status,
  onRetry,
}: {
  client: SecurityClient | null;
  status: SecurityConnectionStatus;
  onRetry: () => void;
}) {
  const { t, format } = useI18n();
  const [schedule, setSchedule] = useState<SecurityScanScheduleView | null>(
    null,
  );
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<readonly string[]>([]);
  const [scheduleStatus, setScheduleStatus] =
    useState<SecurityScanScheduleStatusView | null>(null);

  useEffect(() => {
    if (client == null) return;
    let cancelled = false;
    setLoadError(false);
    setSchedule(null);
    Promise.all([client.getScanSchedule(), client.getScanScheduleStatus()])
      .then(([next, nextStatus]) => {
        if (!cancelled) {
          setSchedule(next);
          setScheduleStatus(nextStatus);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        toast.error(t("settings.security.schedule.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadTick, t]);

  useEffect(() => {
    if (client == null) return;
    let cancelled = false;
    const refresh = () => {
      void client
        .getScanScheduleStatus()
        .then((next) => {
          if (!cancelled) setScheduleStatus(next);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client]);

  // 真实可选的 Agent 列表来自已发现 Skill 的 agents 元数据。
  useEffect(() => {
    if (client == null) return;
    let cancelled = false;
    client
      .listSkills()
      .then((skills) => {
        if (cancelled) return;
        const names = [
          ...new Set(skills.flatMap((skill) => skill.agents)),
        ].sort((left, right) => left.localeCompare(right));
        setAgents(names);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const retryLoad = () => setReloadTick((value) => value + 1);

  const save = async (next: SecurityScanScheduleView) => {
    if (client == null) return;
    const previous = schedule;
    setSchedule(next);
    setSaving(true);
    try {
      const saved = await client.setScanSchedule(next);
      setSchedule(saved);
      setScheduleStatus(await client.getScanScheduleStatus());
      toast.success(t("settings.security.schedule.saved"));
    } catch {
      if (previous != null) setSchedule(previous);
      toast.error(t("settings.security.schedule.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  let content: ReactNode;
  if (status === "unavailable") {
    content = <SecurityUnavailable onRetry={onRetry} />;
  } else if (loadError) {
    content = (
      <SecurityLoadError
        message={t("settings.security.schedule.loadFailed")}
        onRetry={retryLoad}
      />
    );
  } else if (schedule == null) {
    content = (
      <Field label={t("settings.security.schedule.title")}>
        <span className="tt-text-body text-muted-foreground">
          {t("common.loading")}
        </span>
      </Field>
    );
  } else {
    const disabled = saving;
    const lastRun = scheduleStatus?.lastRun;
    const lastRunDetail =
      lastRun == null
        ? t("settings.security.schedule.neverRun")
        : lastRun.status === "complete" &&
            lastRun.queuedCount > 0 &&
            lastRun.skippedCount === lastRun.queuedCount
          ? t("settings.security.schedule.allUnchanged", {
              time: format.formatDateTime(
                lastRun.finishedAt ?? lastRun.startedAt,
                false,
              ),
              count: lastRun.skippedCount,
            })
          : t("settings.security.schedule.runSummary", {
              time: format.formatDateTime(
                lastRun.finishedAt ?? lastRun.startedAt,
                false,
              ),
              completed: lastRun.completedCount,
              failed: lastRun.failedCount,
              skipped: lastRun.skippedCount,
            });
    const nextRunDetail = !schedule.enabled
      ? t("settings.security.schedule.disabledStatus")
      : scheduleStatus?.pending
        ? t("settings.security.schedule.pending")
        : scheduleStatus?.nextRunAt
          ? format.formatDateTime(scheduleStatus.nextRunAt, false)
          : t("common.loading");
    content = (
      <div>
        <Field
          label={t("settings.security.schedule.enabled")}
          hint={t("settings.security.schedule.enabledHint")}
        >
          <Toggle
            value={schedule.enabled}
            onChange={(enabled) => void save({ ...schedule, enabled })}
            disabled={disabled}
          />
        </Field>

        <Field label={t("settings.security.schedule.cycle")}>
          <div className="flex flex-wrap gap-1.5">
            {CYCLE_OPTIONS.map((cycle) => (
              <Chip
                key={cycle}
                active={schedule.cycle === cycle}
                disabled={disabled}
                onClick={() => void save({ ...schedule, cycle })}
              >
                {t(`settings.security.schedule.${cycleKeys[cycle]}`)}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label={t("settings.security.schedule.time")}>
          <input
            type="time"
            value={schedule.time}
            onChange={(event) =>
              void save({ ...schedule, time: event.target.value })
            }
            disabled={disabled}
            className="security-config-input max-w-[9rem]"
          />
        </Field>

        <Field
          label={t("settings.security.schedule.scope")}
          hint={
            schedule.scope === "agent"
              ? t("settings.security.schedule.agentHint")
              : schedule.scope === "dir"
                ? t("settings.security.schedule.dirHint")
                : t("settings.security.schedule.scopeHint")
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {SCOPE_OPTIONS.map((scope) => (
              <Chip
                key={scope}
                active={schedule.scope === scope}
                disabled={disabled}
                onClick={() => void save({ ...schedule, scope })}
              >
                {t(`settings.security.schedule.${scopeKeys[scope]}`)}
              </Chip>
            ))}
          </div>
        </Field>

        {schedule.scope === "agent" && (
          <Field
            label={t("settings.security.schedule.scopeAgent")}
            hint={t("settings.security.schedule.agentHint")}
          >
            {agents.length === 0 ? (
              <span className="tt-text-body-sm font-mono text-muted-foreground">
                {t("common.loading")}
              </span>
            ) : (
              <div className="flex flex-wrap justify-end gap-1.5">
                {agents.map((agent) => {
                  const on = schedule.agents.includes(agent);
                  return (
                    <Chip
                      key={agent}
                      active={on}
                      disabled={disabled}
                      onClick={() => {
                        const next = on
                          ? schedule.agents.filter((name) => name !== agent)
                          : [...schedule.agents, agent];
                        void save({ ...schedule, agents: next });
                      }}
                    >
                      {agent}
                    </Chip>
                  );
                })}
              </div>
            )}
          </Field>
        )}

        {schedule.scope === "dir" && (
          <Field
            label={t("settings.security.schedule.scopeDir")}
            hint={t("settings.security.schedule.dirHint")}
          >
            <input
              type="text"
              value={schedule.dir ?? ""}
              placeholder="/path/to/skills"
              onChange={(event) =>
                void save({ ...schedule, dir: event.target.value || null })
              }
              disabled={disabled}
              className="security-config-input max-w-[15rem]"
            />
          </Field>
        )}

        <Field label={t("settings.security.schedule.notify")}>
          <Toggle
            value={schedule.notify}
            onChange={(notify) => void save({ ...schedule, notify })}
            disabled={disabled}
          />
        </Field>

        <Field label={t("settings.security.schedule.lastRun")}>
          <span className="tt-text-caption text-right font-mono text-muted-foreground">
            {lastRunDetail}
          </span>
        </Field>

        <Field
          label={t("settings.security.schedule.nextRun")}
          hint={t("settings.security.schedule.processRequiredHint")}
        >
          <span className="tt-text-caption text-right font-mono text-muted-foreground">
            {nextRunDetail}
          </span>
        </Field>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading icon={<CalendarClock className="size-3.5" />}>
        {t("settings.security.schedule.title")}
      </SectionHeading>
      {content}
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`tt-text-caption rounded-lg px-2.5 py-1.5 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-foreground text-background"
          : "bg-surface text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
