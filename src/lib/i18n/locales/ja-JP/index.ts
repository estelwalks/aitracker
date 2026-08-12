// AI 翻訳稿、審校待ち (2026-08)
import type { Translations } from "../../schema";

import { common } from "./common";
import { distill } from "./distill";
import { dashboard } from "./dashboard";
import { errors } from "./errors";
import { exportMessages } from "./export";
import { insights } from "./insights";
import { market } from "./market";
import { meta } from "./meta";
import { nav } from "./nav";
import { pricing } from "./pricing";
import { tracker } from "./tracker";
import { skills } from "./skills";
import { security } from "./security";
import { sessions } from "./sessions";
import { sources } from "./sources";
import { settings } from "./settings";
import { theme } from "./theme";

export const ja = {
  common,
  distill,
  dashboard,
  insights,
  pricing,

  nav,
  skills,
  security,
  sessions,
  sources,
  settings,
  market,
  tracker,
  meta,
  errors,
  export: exportMessages,
  theme,
} as const satisfies Translations;
