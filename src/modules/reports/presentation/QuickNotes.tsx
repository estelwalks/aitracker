import { useEffect, useState } from "react";
import { Plus, StickyNote, X } from "lucide-react";

import { TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";

const NOTES_KEY = "tt.reports.notes";
const CHIP_KEYS = ["archived", "review", "highlight", "followup"] as const;
const MAX_NOTES = 30;

function readNotes(): string[] {
  try {
    const raw = window.localStorage.getItem(NOTES_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, MAX_NOTES)
      : [];
  } catch {
    return [];
  }
}

/**
 * 快捷批注 (quick annotations): 4 preset chips + a custom input, persisted to
 * `tt.reports.notes` in this browser. Non-functional (does not feed any report)
 * but genuinely persisted so annotations survive reloads.
 */
export function QuickNotes() {
  const { t } = useI18n();
  const [notes, setNotes] = useState<string[]>(readNotes);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      // localStorage unavailable — notes are best-effort
    }
  }, [notes]);

  const add = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setNotes((current) => [trimmed, ...current].slice(0, MAX_NOTES));
    setDraft("");
  };

  const remove = (index: number) =>
    setNotes((current) => current.filter((_, i) => i !== index));

  return (
    <section className="tt-panel mt-3 flex flex-col p-5">
      <header className="flex items-center gap-2">
        <StickyNote className="size-3.5 text-muted-foreground" />
        <h2 className="text-[13px] font-medium tracking-[0.025em]">
          {t("reports.notes.title")}
        </h2>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {CHIP_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => add(t(`reports.notes.chips.${key}`))}
            className="rounded-full bg-surface-2 px-3 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            + {t(`reports.notes.chips.${key}`)}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add(draft);
          }}
          placeholder={t("reports.notes.placeholder")}
          aria-label={t("reports.notes.placeholder")}
          className="h-8 min-w-0 flex-1 rounded-lg bg-surface-2/70 px-3 text-[12.5px] outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
        />
        <TTButton size="sm" variant="primary" onClick={() => add(draft)}>
          <Plus className="size-3.5" />
          {t("reports.notes.add")}
        </TTButton>
      </div>

      {notes.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t("reports.notes.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {notes.map((note, index) => (
            <li
              key={`${note}-${index}`}
              className="group flex items-center justify-between gap-2 rounded-lg bg-surface-2/50 px-3 py-1.5 text-[12px]"
            >
              <span className="min-w-0 flex-1 truncate">{note}</span>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={t("common.close")}
                className="shrink-0 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
