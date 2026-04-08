/**
 * Client for the backend ChatGPT API.
 * Uses Vite proxy: /api -> backend (see vite.config.ts).
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  /** When a call was placed via place_call tool */
  callId?: string;
  /** Call purpose (full description) - used as task description */
  callReason?: string;
  /** Intent domain (e.g. pet_services, healthcare) - used as task title / Issue Type */
  domain?: string;
}

export interface GetChatResponseOptions {
  /** JWT from call-backend sign-in. Sent as Authorization: Bearer. Required for placing calls when backend uses per-user auth. */
  callBackendToken?: string | null;
  /** User's profile name (from Profile tab). Sent so the AI can suggest it when asking for the call name; user can override by typing a different name. */
  profileName?: string | null;
}

/**
 * Sends the conversation to the backend and returns the assistant reply (and optional callId), or null on error/disabled.
 */
export async function getChatResponse(
  messages: ChatMessage[],
  options?: GetChatResponseOptions,
): Promise<ChatResponse | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = options?.callBackendToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const body: {
    messages: ChatMessage[];
    callBackendToken?: string;
    profileName?: string;
  } = {
    messages,
  };
  if (token) body.callBackendToken = token;
  const profileName = options?.profileName?.trim();
  if (profileName) body.profileName = profileName;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 503) return null; // API not configured – use demo
      const data = await res.json().catch(() => ({}));
      console.warn("Chat API error:", res.status, data);
      return null;
    }
    const data: ChatResponse = await res.json();
    return data;
  } catch (e) {
    console.warn("Chat API request failed:", e);
    return null;
  }
}

export interface CallStatus {
  id: string;
  status: string;
  transcript: { role: string; content: string; timestamp?: string }[];
  startedAt?: string;
  endedAt?: string;
  cost?: number;
  /** Cumulative Realtime usage when call backend persists them (GET /api/calls/:id). */
  input_tokens?: number;
  output_tokens?: number;
}

export interface GetCallStatusOptions {
  /** JWT from call-backend sign-in. Sent as Authorization: Bearer. */
  callBackendToken?: string | null;
}

/**
 * After placing a call, GET /api/calls/:id may 404 briefly before the record exists.
 * Ignore "call not found" for this long after opening the transcript / detail poller so we don't resolve at call start.
 */
export const CALL_STATUS_SESSION_GRACE_MS = 60_000;

/** True when the call backend reports a finished call (case-insensitive). */
export function isCallEndedStatus(status: string | undefined | null): boolean {
  const v = String(status ?? "").toLowerCase().trim();
  return (
    v === "ended" ||
    v === "done" ||
    v === "completed" ||
    v === "complete" ||
    v === "finished" ||
    v === "failed" ||
    v === "cancelled" ||
    v === "canceled"
  );
}

export type GetCallStatusMetaResult =
  | { ok: true; data: CallStatus }
  | {
      ok: false;
      /** Call backend / proxy says this id no longer exists — UI should stop "ongoing" polling. */
      callNotFound: boolean;
      httpStatus: number;
      message?: string;
    };

/**
 * Same as getCallStatus but preserves HTTP / error shape so callers can treat "call not found" as terminal.
 */
export async function getCallStatusWithMeta(
  callId: string,
  options?: GetCallStatusOptions,
): Promise<GetCallStatusMetaResult> {
  const headers: Record<string, string> = {};
  const token = options?.callBackendToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`/api/call/${callId}`, { headers });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    const errStr = String(data.error ?? data.message ?? "").trim();
    const looksNotFound =
      /not\s*found|call not found|unknown call|invalid call/i.test(errStr);

    if (!res.ok) {
      const callNotFound =
        res.status === 404 || (res.status === 502 && looksNotFound);
      return {
        ok: false,
        callNotFound,
        httpStatus: res.status,
        message: errStr || undefined,
      };
    }
    if (data.error != null) {
      return {
        ok: false,
        callNotFound: looksNotFound,
        httpStatus: res.status,
        message: errStr || undefined,
      };
    }
    return { ok: true, data: data as CallStatus };
  } catch (e) {
    console.warn("Call status request failed:", e);
    return { ok: false, callNotFound: false, httpStatus: 0 };
  }
}

/** Single transcript segment from GET /api/calls/:id/transcripts */
export interface CallTranscriptSegment {
  id: string;
  call_id: string;
  speaker: "ai" | "human";
  message: string;
  timestamp: string;
  confidence?: number;
}

/** Response from GET /api/calls/:id/transcripts */
export interface GetTranscriptsResponse {
  success: boolean;
  transcripts: CallTranscriptSegment[];
  count: number;
}

/**
 * Fetches full transcript records for a call (after call ends).
 * GET /api/calls/:callId/transcripts — ordered by timestamp.
 */
export async function getTranscripts(
  callId: string,
  options?: GetCallStatusOptions,
): Promise<GetTranscriptsResponse | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = options?.callBackendToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`/api/calls/${callId}/transcripts`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.transcripts)) return null;
    return data as GetTranscriptsResponse;
  } catch (e) {
    console.warn("getTranscripts failed", e);
    return null;
  }
}

/**
 * Returns the call backend base URL (same origin as CALL_BACKEND_URL). Used by the Socket.io client for live transcript and call status.
 * Returns null if not configured or request fails.
 */
export async function getCallBackendUrl(): Promise<string | null> {
  try {
    const res = await fetch("/api/call-backend-url");
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const url = (data.url ?? "").trim().replace(/\/+$/, "");
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Fetches call status and transcript from the backend (polls GPT-4o Realtime call backend).
 */
export async function getCallStatus(
  callId: string,
  options?: GetCallStatusOptions,
): Promise<CallStatus | null> {
  const r = await getCallStatusWithMeta(callId, options);
  return r.ok ? r.data : null;
}

export interface SummarizeCallOptions extends GetCallStatusOptions {
  /** When provided (e.g. from modal onCallComplete), server uses this instead of fetching from call backend. */
  transcript?: string | null;
}

/**
 * Result of summarizeCall. usefulInfoObtained is false when the call did not obtain the requested info (e.g. no price given).
 */
export interface SummarizeCallResult {
  summary: string;
  usefulInfoObtained?: boolean;
}

/**
 * Request AI summarization of a call with respect to its purpose.
 * POST /api/call/:callId/summarize — returns { summary, usefulInfoObtained } or null on error.
 * Pass options.transcript when you already have the transcript (e.g. from the transcript modal) so the server doesn't need to wait for the call backend.
 */
export async function summarizeCall(
  callId: string,
  purpose: string,
  options?: SummarizeCallOptions,
): Promise<SummarizeCallResult | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = options?.callBackendToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const body: { purpose?: string; transcript?: string } = { purpose: purpose || "" };
  if (options?.transcript != null && options.transcript !== "") body.transcript = options.transcript;
  try {
    const res = await fetch(`/api/call/${callId}/summarize`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return {
      summary: data.summary ?? "",
      usefulInfoObtained: Object.prototype.hasOwnProperty.call(data, "usefulInfoObtained")
        ? Boolean(data.usefulInfoObtained)
        : true,
    };
  } catch (e) {
    console.warn("summarizeCall failed", e);
    return null;
  }
}

/**
 * Retry a call with the same phone and purpose (e.g. when the first call did not obtain useful information).
 * POST /api/call/retry — body: { callId, purpose, phone_number? }. Returns { callId: newCallId } or null.
 * Only intended for one retry per task.
 */
export async function retryCall(
  callId: string,
  purpose: string,
  options?: GetCallStatusOptions & { phone_number?: string | null },
): Promise<{ callId: string } | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = options?.callBackendToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const body: { callId: string; purpose: string; phone_number?: string } = {
    callId,
    purpose: purpose || "",
  };
  if (options?.phone_number != null && options.phone_number !== "")
    body.phone_number = options.phone_number;
  try {
    const res = await fetch("/api/call/retry", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return data.callId ? { callId: data.callId } : null;
  } catch (e) {
    console.warn("retryCall failed", e);
    return null;
  }
}

/** Conversation list item (Supabase + Redis backend). */
export interface ConversationItem {
  id: string;
  user_id: string;
  state: string;
  created_at: string;
  updated_at: string;
}

/** Chat message from history API. */
export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const DEBUG_CHAT = import.meta.env.DEV; // log only in development

/**
 * List conversations for a user (Python backend: Supabase persistence).
 */
export async function getConversations(
  userId: string,
): Promise<ConversationItem[]> {
  const url = `/api/conversations?user_id=${encodeURIComponent(userId)}`;
  if (DEBUG_CHAT) console.log("[History] getConversations", { userId, url });
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (DEBUG_CHAT)
      console.log("[History] getConversations response", {
        status: res.status,
        ok: res.ok,
        data,
      });
    if (!res.ok) {
      if (DEBUG_CHAT)
        console.warn("[History] getConversations not ok", res.status, data);
      return [];
    }
    const list = data.conversations ?? [];
    if (DEBUG_CHAT)
      console.log("[History] getConversations count", list.length);
    return list;
  } catch (e) {
    console.warn("[History] getConversations failed", e);
    return [];
  }
}

/**
 * Delete a conversation and its messages (Python backend).
 */
export async function deleteConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (e) {
    console.warn("[History] deleteConversation failed", e);
    return false;
  }
}

/**
 * Get messages for a conversation (Python backend).
 */
export async function getConversationMessages(
  conversationId: string,
): Promise<HistoryMessage[]> {
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/messages`;
  if (DEBUG_CHAT)
    console.log("[History] getConversationMessages", { conversationId, url });
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (DEBUG_CHAT)
      console.log("[History] getConversationMessages response", {
        status: res.status,
        ok: res.ok,
      });
    if (!res.ok) {
      if (DEBUG_CHAT)
        console.warn(
          "[History] getConversationMessages not ok",
          res.status,
          data,
        );
      return [];
    }
    const list = data.messages ?? [];
    if (DEBUG_CHAT)
      console.log("[History] getConversationMessages count", list.length);
    return list;
  } catch (e) {
    console.warn("[History] getConversationMessages failed", e);
    return [];
  }
}

/** Pet profile from API (Supabase pet_profiles). */
export interface PetProfileFromApi {
  id: string;
  user_id: string;
  name: string;
  species: string | null;
  breed: string | null;
  age: string | null;
  weight: string | null;
  date_of_birth: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * List pet profiles for a user (Python backend → Supabase).
 */
export async function getPetProfiles(
  userId: string,
): Promise<PetProfileFromApi[]> {
  try {
    const res = await fetch(
      `/api/pet-profiles?user_id=${encodeURIComponent(userId)}`,
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.pet_profiles ?? [];
  } catch (e) {
    console.warn("getPetProfiles failed", e);
    return [];
  }
}

/**
 * Create a pet profile (Python backend → Supabase).
 */
export async function createPetProfile(
  userId: string,
  pet: {
    name: string;
    species?: string;
    breed?: string;
    date_of_birth?: string;
    weight?: string;
  },
): Promise<PetProfileFromApi | null> {
  try {
    const res = await fetch("/api/pet-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        name: pet.name,
        species: pet.species ?? null,
        breed: pet.breed ?? null,
        date_of_birth: pet.date_of_birth || null,
        weight: pet.weight ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(
        "createPetProfile failed",
        res.status,
        text || res.statusText,
      );
      return null;
    }
    const data = await res.json().catch(() => null);
    return data as PetProfileFromApi;
  } catch (e) {
    console.warn("createPetProfile failed", e);
    return null;
  }
}

/**
 * Delete a pet profile (Python backend → Supabase).
 */
export async function deletePetProfile(
  userId: string,
  petProfileId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/pet-profiles/${encodeURIComponent(petProfileId)}?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (e) {
    console.warn("deletePetProfile failed", e);
    return false;
  }
}

/**
 * Send one message and get reply (Python backend: state machine chat).
 * Returns reply_text, conversation_id, debug_state, and optional ui_options.
 * Pass callBackendToken when placing calls so the backend can authenticate with the call service.
 */
export async function sendChatMessage(
  userId: string,
  message: string,
  conversationId?: string | null,
  options?: { callBackendToken?: string | null },
): Promise<{
  reply_text: string;
  conversation_id: string;
  debug_state: string;
  ui_options?: unknown[];
  free_trial_remaining?: number;
  error?: string;
  code?: string;
} | null> {
  const body: Record<string, unknown> = {
    user_id: userId,
    message,
    conversation_id: conversationId || undefined,
  };
  const token = options?.callBackendToken?.trim();
  if (token) {
    body.callBackendToken = token;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (DEBUG_CHAT)
    console.log("[History] sendChatMessage", {
      userId,
      messageLength: message.length,
      conversationId: conversationId ?? "new",
    });
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (DEBUG_CHAT)
      console.log("[History] sendChatMessage response", {
        status: res.status,
        ok: res.ok,
        conversation_id: (data as { conversation_id?: string }).conversation_id,
        debug_state: (data as { debug_state?: string }).debug_state,
      });
    if (!res.ok) {
      if (DEBUG_CHAT)
        console.warn("[History] sendChatMessage not ok", res.status, data);
      if (import.meta.env.DEV)
        console.warn(
          "[Holdless] Chat not saved to history: backend returned",
          res.status,
          "- Ensure Python backend is running and Node proxies POST /api/chat (see server .env PYTHON_BACKEND_URL).",
        );
      return null;
    }
    return data as {
      reply_text: string;
      conversation_id: string;
      debug_state: string;
      ui_options?: unknown[];
      task_id?: string;
      callId?: string;
      callReason?: string;
      /** Intent domain (e.g. pet_services) - set by Node when call is placed */
      domain?: string;
      free_trial_remaining?: number;
      error?: string;
      code?: string;
    };
  } catch (e) {
    console.warn("[History] sendChatMessage failed", e);
    return null;
  }
}

// ========== Tasks (Supabase persistence for Dashboard) ==========

/** Task row from API (Supabase tasks table). */
export interface TaskRowFromApi {
  id: string;
  user_id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  domain?: string | null;
  task?: string | null;
  parent_task_id?: string | null;
  slots?: Record<string, unknown>;
}

/**
 * List tasks for a user (Python backend → Supabase).
 */
export async function getTasks(userId: string): Promise<TaskRowFromApi[]> {
  try {
    const res = await fetch(`/api/tasks?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const list = data.tasks ?? [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn("getTasks failed", e);
    return [];
  }
}

/**
 * Create a task. payload should include type: 'generic' | 'call' and task-specific fields.
 */
export async function createTask(
  userId: string,
  options: { status?: string; payload: Record<string, unknown> },
): Promise<TaskRowFromApi | null> {
  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        status: options.status ?? "ready_to_queue",
        payload: options.payload ?? {},
      }),
    });
    if (!res.ok) return null;
    const row = await res.json().catch(() => null);
    return row as TaskRowFromApi;
  } catch (e) {
    console.warn("createTask failed", e);
    return null;
  }
}

/**
 * Update a task. Only provided status/payload are updated.
 */
export async function updateTask(
  userId: string,
  taskId: string,
  options: { status?: string; payload?: Record<string, unknown> },
): Promise<TaskRowFromApi | null> {
  try {
    const url = `/api/tasks/${encodeURIComponent(taskId)}?user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: options.status ?? undefined,
        payload: options.payload ?? undefined,
      }),
    });
    if (!res.ok) return null;
    const row = await res.json().catch(() => null);
    return row as TaskRowFromApi;
  } catch (e) {
    console.warn("updateTask failed", e);
    return null;
  }
}
