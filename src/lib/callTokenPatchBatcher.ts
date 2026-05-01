/**
 * Merges token/usage patch objects per callId and flushes at most once per `ms`
 * (per callId) while updates keep arriving. Reduces PATCH /api/tasks spam from
 * high-frequency Socket.IO `usage_update` events.
 */
export function createCallTokenPatchBatcher(
  ms: number,
  onFlush: (callId: string, patch: Record<string, unknown>) => void | Promise<void>,
) {
  const pending = new Map<string, Record<string, unknown>>();
  const timer = new Map<string, ReturnType<typeof setTimeout>>();

  function doFlush(id: string) {
    const t = timer.get(id);
    if (t != null) {
      clearTimeout(t);
      timer.delete(id);
    }
    const p = pending.get(id);
    pending.delete(id);
    if (p && Object.keys(p).length) void onFlush(id, p);
  }

  return {
    /** Queue patch; if no timer, schedule flush in `ms`. Merges with any pending. */
    push(callId: string, patch: Record<string, unknown>) {
      if (!callId) return;
      const merged = { ...(pending.get(callId) ?? {}), ...patch };
      pending.set(callId, merged);
      if (timer.has(callId)) return;
      timer.set(
        callId,
        setTimeout(() => {
          doFlush(callId);
        }, ms),
      );
    },
    /** Flush a single call's pending patch immediately. */
    flushCall(callId: string) {
      if (timer.has(callId) || pending.has(callId)) doFlush(callId);
    },
    /** Run all pending and clear timers. Use on unmount. */
    flushAll() {
      for (const id of [...new Set([...timer.keys(), ...pending.keys()])]) {
        doFlush(id);
      }
    },
  };
}
