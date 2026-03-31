export function toE164BestEffort(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;

  // If it's already E.164-ish, keep it.
  if (raw.startsWith("+") && /^\+\d{8,15}$/.test(raw)) {
    return raw;
  }

  // If it's digits-only (common from SIP/telephony headers), prefix '+'.
  if (/^\d{8,15}$/.test(raw)) {
    return `+${raw}`;
  }

  // Try to salvage digits from things like 'sip:9177...@host' or 'tel:+9177...'
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && /^\+\d{8,15}$/.test(digits)) {
    return digits;
  }
  const digitsOnly = digits.replace(/[^\d]/g, "");
  if (/^\d{8,15}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }

  return undefined;
}

