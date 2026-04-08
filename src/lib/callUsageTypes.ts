/** Socket.IO payloads for OpenAI Realtime call token metering (call backend). */

export type UsageUpdatePayload = {
  call_id: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  limit_tokens: number | null;
  percent_of_limit: number | null;
};

export type QuotaWarningPayload = {
  call_id: string;
  threshold: number;
  used_tokens: number;
  limit_tokens: number;
  percent: number;
};

export type CallEndingPayload = {
  call_id: string;
  reason: string;
  message: string;
  used_tokens: number;
  limit_tokens: number;
};

export type CallEndedUsagePayload = {
  call_id: string;
  outcome?: string;
  duration: number;
  ended_at?: string;
  end_reason?: "token_budget";
};

export function parseUsageUpdatePayload(raw: unknown): UsageUpdatePayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const call_id = typeof o.call_id === "string" ? o.call_id : null;
  if (!call_id) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    call_id,
    input_tokens: num(o.input_tokens),
    output_tokens: num(o.output_tokens),
    total_tokens: num(o.total_tokens),
    limit_tokens:
      o.limit_tokens === null || o.limit_tokens === undefined
        ? null
        : num(o.limit_tokens),
    percent_of_limit:
      o.percent_of_limit === null || o.percent_of_limit === undefined
        ? null
        : num(o.percent_of_limit),
  };
}
