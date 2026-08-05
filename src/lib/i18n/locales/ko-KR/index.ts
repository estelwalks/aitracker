// AI 번역 초안, 검토 대기 (2026-08)
import type { Translations } from "../../messages";

import { common } from "./common";
import { dashboard } from "./dashboard";
import { errors } from "./errors";
import { exportMessages } from "./export";
import { market } from "./market";
import { meta } from "./meta";
import { nav } from "./nav";
import { pricing } from "./pricing";
import { skills } from "./skills";
import { security } from "./security";
import { sessions } from "./sessions";
import { sources } from "./sources";
import { settings } from "./settings";
import { theme } from "./theme";

export const ko = {
  common,
  dashboard,
  pricing,

  nav,
  skills,
  security,
  sessions,
  sources,
  settings,
  market,
  meta,
  errors,
  export: exportMessages,
  theme,
} as const satisfies Translations;
