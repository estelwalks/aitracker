import type { BoundFormatters } from "../i18n/format";
import type { MessageKey, MessageParams } from "../i18n/messages";
import type { CostEstimate } from "./index";

/**
 * Compose a display cost label at the UI boundary: bare amount in the shared
 * display currency/rate snapshot, or translated "price unknown" /
 * "(partially unknown)" wording from the catalogs. All cost displays use this
 * so every amount shares one currency + one exchange-rate snapshot.
 */
export function formatCostLabel(
  t: <K extends MessageKey>(key: K, params?: MessageParams<K>) => string,
  format: BoundFormatters & { formatUsd: (amountUsd: number) => string },
  cost: CostEstimate,
): string {
  if (cost.pricedEvents === 0 && cost.unknownEvents > 0) {
    return t("pricing.unknown");
  }
  const amount = format.formatUsd(cost.knownUsd);
  if (cost.unknownEvents > 0) {
    return t("pricing.partialUnknown", { amount });
  }
  return amount;
}
