import type { Translations } from "../../schema";

import { common } from "./common";
import { dashboard } from "./dashboard";
import { errors } from "./errors";
import { exportMessages } from "./export";
import { insights } from "./insights";
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
import { tracker } from "./tracker";

export const en = {
  common,
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
