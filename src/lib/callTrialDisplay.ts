/** localStorage key for last known phone-call trial remaining (from call backend). */
export function callTrialStorageKey(userId: string): string {
  return `holdless:callTrialRemaining:${userId}`;
}

export function readStoredCallTrialRemaining(userId: string | null | undefined): number | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(callTrialStorageKey(userId));
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function persistCallTrialRemaining(
  userId: string | null | undefined,
  value: number,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(callTrialStorageKey(userId), String(value));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Tokens tab display: remaining **outbound call slots** (Holdless DB quota is decremented
 * only after a successful call placement — not when chatting). When the phone-call service
 * reports a stricter `free_trial_remaining`, we show the lower of the two.
 */
export function mergeHoldlessCallSlotsWithPhoneTrial(
  holdlessCallSlotsRemaining: number,
  phoneTrialRemaining: number | null | undefined,
): number {
  const cap = phoneTrialRemaining ?? Infinity;
  return Math.min(holdlessCallSlotsRemaining, cap);
}

type ChatTrialPayload = {
  request_quota_remaining?: number;
  free_trial_remaining?: number;
  call_trial_remaining?: number;
};

/**
 * Updates the Tokens header count from a `/api/chat` JSON payload (call slots + optional phone-trial).
 * Chat turns that do not place a call still include `request_quota_remaining` — it stays unchanged.
 */
export function callTrialRemainingFromChatResponse(
  userId: string | null | undefined,
  data: ChatTrialPayload | null | undefined,
): number | undefined {
  if (!data) return undefined;
  const req =
    typeof data.request_quota_remaining === "number"
      ? data.request_quota_remaining
      : typeof data.free_trial_remaining === "number"
        ? data.free_trial_remaining
        : undefined;
  if (req === undefined || !Number.isFinite(req)) return undefined;

  const fromCall =
    typeof data.call_trial_remaining === "number" && Number.isFinite(data.call_trial_remaining)
      ? data.call_trial_remaining
      : undefined;
  if (fromCall !== undefined) persistCallTrialRemaining(userId, fromCall);

  const stored = readStoredCallTrialRemaining(userId);
  const callCap = fromCall !== undefined ? fromCall : stored;
  return mergeHoldlessCallSlotsWithPhoneTrial(req, callCap);
}
