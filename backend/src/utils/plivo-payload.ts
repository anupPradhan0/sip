/**
 * Pure helpers for Plivo Answer URL query/body fields (no Express types).
 */

export function firstPlivoString(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  if (Array.isArray(val) && typeof val[0] === "string" && val[0].trim()) return val[0].trim();
  return undefined;
}

const KULLOO_CALL_ID_KEYS = [
  "kullooCallId",
  "X-PH-KullooCallId",
  "x-ph-kulloocallid",
  "X_PH_KullooCallId",
  "SipHeader_X-PH-KullooCallId",
] as const;

/**
 * Value is `Call._id` hex; header name on SIP remains `KullooCallId`.
 */
export function extractKullooCallIdFromSources(
  query: Record<string, unknown>,
  body: Record<string, unknown>,
): string | undefined {
  for (const src of [query, body]) {
    for (const key of KULLOO_CALL_ID_KEYS) {
      const v = firstPlivoString(src[key]);
      if (v && /^[a-fA-F0-9]{24}$/.test(v)) return v;
    }
  }

  for (const src of [query, body]) {
    for (const [key, val] of Object.entries(src)) {
      if (/kulloocallid/i.test(key)) {
        const v = firstPlivoString(val);
        if (v && /^[a-fA-F0-9]{24}$/.test(v)) return v;
      }
    }
  }

  return undefined;
}

export function extractPlivoCallUuidFromSources(
  query: Record<string, unknown>,
  body: Record<string, unknown>,
): string | undefined {
  return firstPlivoString(query.CallUUID) ?? firstPlivoString(body.CallUUID);
}
