import type { BoundFormatters } from "../i18n/format";
import type { MessageKey, MessageParams } from "../i18n/messages";
import type { CostEstimate } from "./index";

/**
 * The label uses aggregate pricing state only. Accept readonly data so public
 * projections do not need to weaken their immutable `unknownModels` field.
 */
type CostLabelInput = Readonly<
  Pick<
    CostEstimate,
    | "knownUsd"
    | "estimatedUsd"
    | "pricedEvents"
    | "estimatedEvents"
    | "unknownEvents"
  >
>;

/**
 * Compose a display cost label at the UI boundary: bare amount in the shared
 * display currency/rate snapshot, or translated wording from the catalogs
 * ("price unknown", "(partially unknown)", "(estimated)", ...). Estimated
 * amounts are always presented as a labeled subtotal - never disguised as an
 * exact/official cost (audit P1-1 four-state fidelity).
 *
 * Decision order:
 * - nothing priced/estimated and something unknown     -> pricing.unknown
 * - only estimated amounts                             -> pricing.estimated
 * - estimated + unknown (no exact)                     -> pricing.estimatedUnknown
 * - exact + estimated (with or without unknown)        -> pricing.partialEstimated
 * - exact + unknown                                    -> pricing.partialUnknown
 * - only exact                                         -> bare amount
 */
export function formatCostLabel(
  t: <K extends MessageKey>(key: K, params?: MessageParams<K>) => string,
  format: BoundFormatters & { formatUsd: (amountUsd: number) => string },
  cost: CostLabelInput,
): string {
  if (
    cost.pricedEvents === 0 &&
    cost.estimatedEvents === 0 &&
    cost.unknownEvents > 0
  ) {
    return t("pricing.unknown");
  }
  if (cost.estimatedEvents > 0 && cost.pricedEvents === 0) {
    const amount = format.formatUsd(cost.estimatedUsd);
    if (cost.unknownEvents > 0) {
      return t("pricing.estimatedUnknown", { amount });
    }
    return t("pricing.estimated", { amount });
  }
  const amount = format.formatUsd(cost.knownUsd);
  if (cost.estimatedEvents > 0) {
    return t("pricing.partialEstimated", {
      amount,
      estimated: format.formatUsd(cost.estimatedUsd),
    });
  }
  if (cost.unknownEvents > 0) {
    return t("pricing.partialUnknown", { amount });
  }
  return amount;
}
