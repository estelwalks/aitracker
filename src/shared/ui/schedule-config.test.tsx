import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ScheduleChip,
  ScheduleField,
  ScheduleSectionHeading,
  ScheduleToggle,
} from "./schedule-config";

test("schedule configuration primitives preserve the shared security editor styles", () => {
  const html = renderToStaticMarkup(
    <div>
      <ScheduleSectionHeading icon={<span>i</span>}>
        Schedule
      </ScheduleSectionHeading>
      <ScheduleField label="Enabled" hint="Runs in the background">
        <ScheduleToggle
          value
          onChange={() => undefined}
          ariaLabel="Enable schedule"
        />
      </ScheduleField>
      <ScheduleChip active onClick={() => undefined}>
        Daily
      </ScheduleChip>
    </div>,
  );

  assert.match(html, /aitracker-text-section-title/);
  assert.match(html, /border-b border-border py-3/);
  assert.match(html, /aria-label="Enable schedule"/);
  assert.match(html, /h-5 w-9 rounded-full/);
  assert.match(html, /aitracker-text-caption rounded-lg/);
});
