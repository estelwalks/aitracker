import type { Translations } from "../../schema";

import { common } from "./common";
import { distill } from "./distill";
import { dashboard } from "./dashboard";
import { errors } from "./errors";
import { exportMessages } from "./export";
import { insights } from "./insights";
import { market } from "./market";
import { memory } from "./memory";
import { meta } from "./meta";
import { nav } from "./nav";
import { pricing } from "./pricing";
import { privacy } from "./privacy";
import { reports } from "./reports";
import { skills } from "./skills";
import { security } from "./security";
import { sessions } from "./sessions";
import { sources } from "./sources";
import { settings } from "./settings";
import { theme } from "./theme";
import { tracker } from "./tracker";
import { widget } from "./widget";

export const en = {
  common,
  distill,
  dashboard,
  insights,
  reports,
  pricing,
  privacy,

  nav,
  skills,
  security,
  sessions,
  sources,
  settings,
  market,
  tracker,
  memory,
  widget,
  meta,
  errors,
  export: exportMessages,
  theme,
} as const satisfies Translations;
