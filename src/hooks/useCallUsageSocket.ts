import { useEffect, useMemo, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { getCallBackendUrl, getCallStatusWithMeta } from "@/lib/chatApi";
import {
  parseUsageUpdatePayload,
  type UsageUpdatePayload,
} from "@/lib/callUsageTypes";

/**
 * Subscribes to call-backend Socket.IO usage events for active call IDs (in-progress tasks).
 * Persists token fields via onPersistUsage; optionally refreshes from REST on call_ended.
 */
export function useCallUsageSocket(
  callIds: string[],
  options: {
    callBackendToken?: string | null;
    onPersistUsage: (callId: string, patch: Record<string, unknown>) => void | Promise<void>;
  },
) {
  const { callBackendToken } = options;
  const persistRef = useRef(options.onPersistUsage);
  persistRef.current = options.onPersistUsage;

  const idsKey = useMemo(
    () =>
      [...new Set(callIds.filter((id) => typeof id === "string" && id.trim()))].sort().join(","),
    [callIds],
  );

  useEffect(() => {
    if (!idsKey) return;

    let socket: Socket | null = null;
    let cancelled = false;

    const idSet = new Set(idsKey.split(","));

    (async () => {
      const baseUrl = await getCallBackendUrl();
      if (!baseUrl || cancelled) return;

      const token = (callBackendToken ?? "").trim();
      const s = io(baseUrl, {
        auth: token ? { token } : undefined,
        transports: ["websocket", "polling"],
      });
      socket = s;
      if (cancelled) {
        s.disconnect();
        return;
      }

      s.on("connect", () => {
        for (const id of idSet) {
          if (id) s.emit("join_call", id);
        }
      });

      s.on("usage_update", (payload: unknown) => {
        const p = parseUsageUpdatePayload(payload);
        if (!p || !idSet.has(p.call_id)) return;
        void persistRef.current?.(p.call_id, usagePayloadToPatch(p));
      });

      s.on("quota_warning", (payload: unknown) => {
        const o = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
        const call_id = typeof o.call_id === "string" ? o.call_id : "";
        if (!call_id || !idSet.has(call_id)) return;
        const th = typeof o.threshold === "number" ? o.threshold : 0;
        toast.warning(`About ${Math.round(th * 100)}% of call usage reached`, {
          description: "You are approaching the usage limit for this call.",
        });
      });

      s.on("call_ending", (payload: unknown) => {
        const o = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
        const call_id = typeof o.call_id === "string" ? o.call_id : "";
        if (!call_id || !idSet.has(call_id)) return;
        if (o.reason === "token_budget") {
          const msg = typeof o.message === "string" ? o.message : "This call is ending due to usage limits.";
          toast.info(msg);
        }
      });

      s.on("call_ended", (payload: unknown) => {
        const data = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
        const cid = typeof data.call_id === "string" ? data.call_id : "";
        if (!cid || !idSet.has(cid)) return;

        const patch: Record<string, unknown> = {};
        if (data.end_reason === "token_budget") patch.call_end_reason = "token_budget";
        if (typeof data.outcome === "string") patch.call_outcome = data.outcome;

        void (async () => {
          const meta = await getCallStatusWithMeta(cid, { callBackendToken });
          if (meta.ok && meta.data) {
            const d = meta.data as Record<string, unknown>;
            if (typeof d.input_tokens === "number") patch.input_tokens = d.input_tokens;
            if (typeof d.output_tokens === "number") patch.output_tokens = d.output_tokens;
          }
          if (Object.keys(patch).length) await persistRef.current?.(cid, patch);
        })();
      });

      s.on("connect_error", () => {
        /* polling elsewhere may still work; stay quiet */
      });
    })();

    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [idsKey, callBackendToken]);
}

function usagePayloadToPatch(p: UsageUpdatePayload): Record<string, unknown> {
  return {
    input_tokens: p.input_tokens,
    output_tokens: p.output_tokens,
    total_tokens: p.total_tokens,
    limit_tokens: p.limit_tokens,
    percent_of_limit: p.percent_of_limit,
  };
}
