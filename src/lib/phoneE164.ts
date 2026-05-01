/**
 * Best-effort E.164 for U.S. profile-style numbers. Returns null if too few digits.
 */
export function toE164UsPreferred(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const rest = s
      .slice(1)
      .replace(/\D/g, "");
    if (rest.length >= 10) return `+${rest}`;
    return null;
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}
