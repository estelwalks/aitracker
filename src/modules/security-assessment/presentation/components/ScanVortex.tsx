import { X } from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import {
  clampPercent,
  type SecurityRiskKind,
  type SecurityScanStateView,
  type SecuritySkillView,
} from "../security-view";

const COLORS = {
  primary: "#7C3AED",
  cyan: "#06B6D4",
  background: "#0a0a0f",
};

const particles = Array.from({ length: 42 }, (_, index) => ({
  left: (index * 37) % 100,
  top: 40 + ((index * 53) % 60),
  size: 2 + (index % 3),
  delay: (index % 14) * 0.7,
  duration: 7 + (index % 6),
  opacity: 0.2 + ((index * 7) % 50) / 100,
}));

export function ScanVortex({
  state,
  skills,
  riskKinds,
  onCancel,
}: {
  state: SecurityScanStateView;
  skills: readonly SecuritySkillView[];
  riskKinds: readonly SecurityRiskKind[];
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const total = state.progress.queued;
  const settled =
    state.progress.completed + state.progress.failed + state.progress.skipped;
  const currentTarget = state.currentSkill
    ? skills.find((skill) => skill.name === state.currentSkill)
    : undefined;
  const orbit = currentTarget ? [{ ...currentTarget, angle: 0 }] : [];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: COLORS.background,
        animation: "tt-vortex-enter 0.8s ease-out",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("security.center.vortex.title", {
        dimensions: riskKinds.length,
      })}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {particles.map((particle, index) => (
          <span
            key={`${particle.left}-${particle.top}`}
            className="tt-particle absolute rounded-full"
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              width: particle.size,
              height: particle.size,
              background: index % 3 === 0 ? COLORS.cyan : "#c4b5fd",
              opacity: particle.opacity,
              animation: `tt-particle ${particle.duration}s linear ${particle.delay}s infinite`,
            }}
          />
        ))}
      </div>

      <div className="relative flex items-center justify-between px-6 py-4">
        <div className="text-[13px] tracking-wide text-white/70">
          {t("security.center.vortex.title", {
            dimensions: riskKinds.length,
          })}
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={state.status === "cancelling"}
          className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-white/70 transition-colors hover:border-white/40 hover:text-white disabled:opacity-40"
        >
          <X className="size-3.5" /> {t("security.center.vortex.cancel")}
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="relative scale-[0.72] sm:scale-[0.88] lg:scale-100"
          style={{ width: 580, height: 580 }}
        >
          <div
            className="tt-vortex-layer absolute inset-0"
            style={{ animation: "tt-vortex-spin 90s linear infinite" }}
          >
            {orbit.map((skill, index) => {
              const done = index < settled;
              const active = skill.name === state.currentSkill;
              return (
                <div
                  key={skill.skillRef}
                  className="absolute top-1/2 left-1/2"
                  style={{
                    transform: `rotate(${skill.angle}deg) translate(0, -290px) rotate(${-skill.angle}deg)`,
                  }}
                >
                  <div
                    className="absolute"
                    style={{
                      animation: "tt-vortex-spin-rev 90s linear infinite",
                    }}
                  >
                    <div
                      className="grid size-6 place-items-center rounded-[3px] text-[8px] transition-all duration-300"
                      style={{
                        transform: "translate(-50%, -50%)",
                        background: active
                          ? "rgba(6,182,212,0.18)"
                          : done
                            ? "rgba(255,255,255,0.05)"
                            : "rgba(255,255,255,0.09)",
                        border: `1px solid ${active ? COLORS.cyan : done ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.18)"}`,
                        boxShadow: active
                          ? `0 0 14px ${COLORS.cyan}`
                          : undefined,
                        color: "rgba(255,255,255,0.5)",
                      }}
                    >
                      {skill.name.slice(0, 2)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="tt-vortex-layer absolute"
            style={{
              inset: 60,
              animation: "tt-vortex-spin-rev 60s linear infinite",
            }}
          >
            {riskKinds.map((kind, index) => {
              const angle = (360 / Math.max(1, riskKinds.length)) * index;
              return (
                <div
                  key={kind}
                  className="absolute top-1/2 left-1/2"
                  style={{
                    transform: `rotate(${angle}deg) translate(0, -230px) rotate(${-angle}deg)`,
                  }}
                >
                  <div
                    className="absolute"
                    style={{ animation: "tt-vortex-spin 60s linear infinite" }}
                  >
                    <span
                      className="block rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap text-white/40"
                      style={{
                        transform: "translate(-50%, -50%)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      {t(`security.center.risk.${kind}`)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {[
            {
              size: 300,
              duration: "18s",
              direction: "tt-vortex-spin",
              color: COLORS.primary,
              width: 2,
            },
            {
              size: 210,
              duration: "11s",
              direction: "tt-vortex-spin-rev",
              color: COLORS.cyan,
              width: 2,
            },
            {
              size: 130,
              duration: "6s",
              direction: "tt-vortex-spin",
              color: "#ffffff",
              width: 1,
            },
          ].map((ring) => (
            <div
              key={ring.size}
              className="tt-vortex-layer absolute top-1/2 left-1/2 rounded-full"
              style={{
                width: ring.size,
                height: ring.size,
                marginLeft: -ring.size / 2,
                marginTop: -ring.size / 2,
                border: `${ring.width}px dashed ${ring.color}`,
                opacity: 0.55,
                boxShadow: `0 0 40px ${ring.color}55, inset 0 0 40px ${ring.color}33`,
                animation: `${ring.direction} ${ring.duration} linear infinite`,
              }}
            />
          ))}
          <div
            className="absolute top-1/2 left-1/2 size-[90px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: `radial-gradient(circle, #ffffff 0%, ${COLORS.cyan} 45%, ${COLORS.primary} 100%)`,
              filter: "blur(6px)",
              opacity: 0.85,
            }}
          />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/40 bg-black/55 px-4 py-2 text-center text-[11px] whitespace-nowrap text-white shadow-[0_0_25px_rgba(6,182,212,.4)]">
            {state.currentSkill
              ? t("security.center.vortex.current", {
                  name: state.currentSkill,
                })
              : t("security.center.vortex.waiting")}
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/10 px-6 py-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-white/70">
          <span>
            {t("security.center.vortex.progress", {
              completed: settled,
              total,
            })}
          </span>
          <span className="text-white/50">
            {t("security.center.vortex.failures", {
              failed: state.progress.failed,
              skipped: state.progress.skipped,
            })}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${clampPercent(state.progress.percent)}%`,
              background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.cyan})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
