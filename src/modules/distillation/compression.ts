import type { SegmentMaterial } from "./contracts.ts";

const MAX_INPUT_CHARS = 48_000;
const MAX_MESSAGE_CHARS = 6_000;

/**
 * Deterministic, privacy-preserving first-stage compaction before the model.
 * It keeps conversation boundaries and both ends of oversized messages, where
 * requirements and final decisions usually live. The model then performs the
 * semantic second-stage distillation using the output-specific prompt.
 */
export function compactSegmentMaterials(
  materials: readonly SegmentMaterial[],
  limit = MAX_INPUT_CHARS,
): readonly SegmentMaterial[] {
  let remaining = Math.max(1_000, limit);
  const result: SegmentMaterial[] = [];
  for (const material of materials) {
    if (remaining <= 0) break;
    const messages = [];
    for (const message of material.messages) {
      if (remaining <= 0) break;
      const raw = message.text.trim();
      if (!raw) continue;
      const allowance = Math.min(MAX_MESSAGE_CHARS, remaining);
      const text =
        raw.length <= allowance
          ? raw
          : allowance < 200
            ? raw.slice(0, allowance)
            : `${raw.slice(0, Math.floor(allowance * 0.65))}\n[…内容已压缩…]\n${raw.slice(-Math.floor(allowance * 0.3))}`;
      messages.push({ role: message.role, text });
      remaining -= text.length;
    }
    if (messages.length > 0) result.push({ ...material, messages });
  }
  return result;
}
