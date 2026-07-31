import { createServerFn } from "@tanstack/react-start";

import { parseInstallRequest, parseMarketQuery } from "./schema.ts";

export const getMarketSkills = createServerFn({ method: "GET" })
  .validator(parseMarketQuery)
  .handler(async ({ data }) => {
    const { fetchMarketSkills } = await import("./api.server.ts");
    return fetchMarketSkills(data);
  });

export const requestSkillInstall = createServerFn({ method: "POST" })
  .validator(parseInstallRequest)
  .handler(async ({ data }) => {
    const { prepareSkillInstall } = await import("./install.server.ts");
    return prepareSkillInstall(data);
  });
