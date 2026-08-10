import type {
  ProjectPricingPort,
  ProjectReferencePlatform,
  ProjectUsageInput,
  ProjectUsageReadModel,
  ProjectsModuleContract,
} from "../contracts";
import { buildProjectUsageReadModel } from "../domain";
export interface ProjectsApplication {
  readonly contract: ProjectsModuleContract;
}

export function createProjectUsageReadModel(
  input: ProjectUsageInput,
  pricing: ProjectPricingPort,
  platform?: ProjectReferencePlatform,
): ProjectUsageReadModel {
  return buildProjectUsageReadModel(input, pricing, platform);
}
