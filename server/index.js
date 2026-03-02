/**
 * Backend chat API – ChatGPT + Google Places search + outbound calls (GPT-4o Realtime call backend).
 * Run: npm run server (or node server/index.js)
 *
 * .env:
 *   OPENAI_API_KEY=sk-...
 *   GOOGLE_PLACES_API_KEY=...   (optional – for "search nearby X in 90024")
 *
 * Outbound calls – GPT-4o Realtime call backend (required both):
 *   CALL_BACKEND_URL=http://localhost:4000   (or your call backend base URL)
 *   CALL_API_TOKEN=<JWT>                       (Bearer token for POST/GET /api/calls)
 *   TWILIO_PHONE_NUMBER=+1...   (optional – reference)
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = process.env.CHAT_SERVER_PORT || 3001;

app.use(cors());
app.use(express.json());

// GPT-4o Realtime call backend. Token can be: (1) CALL_API_TOKEN in env, or (2) per-request from frontend (Authorization or callBackendToken).
// If your backend has no auth/signin route and no sign-in form in the app, set CALL_API_TOKEN to your backend's API key (or use CALL_BACKEND_ALLOW_NO_AUTH if it requires no auth).
const CALL_BACKEND_URL = (process.env.CALL_BACKEND_URL || "")
  .trim()
  .replace(/\/+$/, "");
const CALL_API_TOKEN = (process.env.CALL_API_TOKEN || "").trim();
const CALL_BACKEND_ALLOW_NO_AUTH =
  (process.env.CALL_BACKEND_ALLOW_NO_AUTH || "").toLowerCase() === "true";
const USE_CALL_BACKEND = !!CALL_BACKEND_URL;

// Python backend (Supabase + Redis): pet profiles, conversations, state-machine chat.
// When frontend uses Node (VITE_API_TARGET=3001), proxy these to Python so pet profiles and history work.
const PYTHON_BACKEND_URL = (
  process.env.PYTHON_BACKEND_URL ||
  process.env.SUPABASE_CHAT_API_URL ||
  "http://localhost:8000"
)
  .trim()
  .replace(/\/+$/, "");
function proxyToPython(req, res) {
  const url = PYTHON_BACKEND_URL + req.originalUrl;
  const headers = { ...req.headers, host: undefined };
  const opts = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined) {
    opts.body = JSON.stringify(req.body);
    if (!headers["content-type"]) headers["Content-Type"] = "application/json";
  }
  fetch(url, opts)
    .then((p) => {
      res.status(p.status);
      p.headers.forEach((v, k) => {
        if (k.toLowerCase() !== "transfer-encoding") res.setHeader(k, v);
      });
      return p.text();
    })
    .then((text) => res.send(text))
    .catch((err) => {
      console.error("[Python proxy]", req.method, req.originalUrl, err.message);
      res
        .status(502)
        .json({ error: "Python backend unavailable", detail: err.message });
    });
}

function getCallBackendToken(req) {
  const auth = req.headers?.authorization;
  const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const fromBody =
    req.body?.callBackendToken && String(req.body.callBackendToken).trim();
  return bearer || fromBody || CALL_API_TOKEN || "";
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Holdless chat API",
    chat: "POST /api/chat",
    intentClassify: "POST /api/intent/classify (body: { message })",
    callStatus: "GET /api/call/:callId",
    callBackendAuth:
      "POST /api/auth/call-backend/signin, POST /api/auth/call-backend/refresh",
    calls: USE_CALL_BACKEND
      ? "Calls via GPT-4o Realtime backend at " +
        CALL_BACKEND_URL +
        " (token from sign-in or CALL_API_TOKEN)"
      : "Calls disabled (configure CALL_BACKEND_URL)",
    docs: "Frontend at http://localhost:8080 – chat and outbound calls via GPT-4o Realtime call backend.",
  });
});

// Proxy to Python backend (Supabase: pet profiles, conversations, state-machine chat).
// When frontend uses Node (VITE_API_TARGET=3001), these routes are forwarded so Profile pets and History work.
app.all("/api/pet-profiles", proxyToPython);
app.all("/api/pet-profiles/:id", proxyToPython);
app.get("/api/conversations", proxyToPython);
  app.delete("/api/conversations/:id", proxyToPython);
  app.get("/api/conversations/:id/messages", proxyToPython);
app.all("/api/tasks", proxyToPython);
app.all("/api/tasks/:taskId", proxyToPython);

// Proxy call-backend auth so frontend can sign in without CORS. Token is then sent as Bearer on /api/chat and /api/call/:id.
if (USE_CALL_BACKEND) {
  app.post("/api/auth/call-backend/signin", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    try {
      const proxy = await fetch(`${CALL_BACKEND_URL}/api/auth/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(email).trim(),
          password: String(password),
        }),
      });
      const data = await proxy.json().catch(() => ({}));
      if (!proxy.ok) {
        return res
          .status(proxy.status)
          .json(data || { error: "Sign-in failed" });
      }
      return res.json(data);
    } catch (err) {
      console.error("[CallBackend Auth] signin proxy error:", err.message);
      return res
        .status(502)
        .json({ error: err.message || "Call backend unavailable" });
    }
  });
  app.post("/api/auth/call-backend/refresh", async (req, res) => {
    const refreshToken = req.body?.refreshToken ?? req.body?.refresh_token;
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken required" });
    }
    const tokenStr = String(refreshToken);
    try {
      const proxy = await fetch(`${CALL_BACKEND_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: tokenStr,
          refresh_token: tokenStr,
        }),
      });
      const data = await proxy.json().catch(() => ({}));
      if (!proxy.ok) {
        return res
          .status(proxy.status)
          .json(data || { error: "Refresh failed" });
      }
      return res.json(data);
    } catch (err) {
      console.error("[CallBackend Auth] refresh proxy error:", err.message);
      return res
        .status(502)
        .json({ error: err.message || "Call backend unavailable" });
    }
  });
  // Frontend uses this URL for Socket.io (live transcript, call status) – same origin as HTTP.
  app.get("/api/call-backend-url", (_req, res) => {
    res.json({ url: CALL_BACKEND_URL });
  });
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const GOOGLE_PLACES_API_KEY =
  process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

// Legacy Vapi env (no longer used – kept for reference only)
// const VAPI_API_KEY = process.env.VAPI_API_KEY;
// const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
// const VAPI_SERVER_URL = process.env.VAPI_SERVER_URL || '';

/**
 * Translate text to English for the call purpose (Realtime backend receives English).
 * Uses OpenAI; on failure returns the original text.
 */
async function translateToEnglish(text) {
  if (!text || typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (!openai) return trimmed;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Translate the following to English. Preserve the meaning and keep it concise. If it is already in English, return it unchanged. Output only the English text, nothing else.\n\n${trimmed}`,
        },
      ],
      max_tokens: 256,
    });
    const out = completion.choices?.[0]?.message?.content?.trim();
    return out || trimmed;
  } catch (err) {
    console.warn("[Translate] failed, using original text:", err.message);
    return trimmed;
  }
}

const PURPOSE_SUMMARY_MAX_LENGTH = 500;

/**
 * Summarize the full conversation into a single call purpose string (max 500 chars).
 * Example: "Get the neuter price of the dog Buddy whose date of birth is..., weight is..., species is..."
 * Uses OpenAI; on failure returns truncated callReason.
 */
async function summarizeChatToPurpose(messages, callReason) {
  if (!openai || !Array.isArray(messages) || messages.length === 0) {
    const fallback = (callReason || "")
      .trim()
      .slice(0, PURPOSE_SUMMARY_MAX_LENGTH);
    return fallback || "Customer inquiry";
  }
  const trimmedReason = (callReason || "").trim();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `You are summarizing a chat so the summary can be sent as the "purpose" of an outbound phone call. The purpose must capture all relevant context from the conversation in one short paragraph, so the person on the call knows exactly what to address.

RULES:
- Output a single paragraph only. No bullet points, no headings.
- Include key details from the chat: e.g. pet name, species, date of birth, weight, service requested (e.g. neuter price), order numbers, or any other specifics the user mentioned.
- Maximum ${PURPOSE_SUMMARY_MAX_LENGTH} characters. If the conversation is short, still produce a clear sentence (e.g. "Get the neuter price of the dog Buddy whose date of birth is ..., weight is ..., species is ...").
- Write in English. Be concise but complete.
- Output ONLY the purpose text, nothing else (no "Purpose:" prefix or quotes).

Conversation (user/assistant messages):\n${messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map(
              (m) =>
                `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
            )
            .join("\n")}

Call reason from the assistant: ${trimmedReason || "(none)"}`,
        },
      ],
      max_tokens: 256,
    });
    const out = (completion.choices?.[0]?.message?.content ?? "").trim();
    const result = out
      ? out.slice(0, PURPOSE_SUMMARY_MAX_LENGTH)
      : trimmedReason.slice(0, PURPOSE_SUMMARY_MAX_LENGTH);
    return result || "Customer inquiry";
  } catch (err) {
    console.warn("[Summarize purpose] failed, using call_reason:", err.message);
    return (trimmedReason || "Customer inquiry").slice(
      0,
      PURPOSE_SUMMARY_MAX_LENGTH,
    );
  }
}

/** Intent classification prompt – classifies if a user message requires calling a business and into domain/task. */
const INTENT_CLASSIFICATION_PROMPT = `You are the intent classification engine for Holdless, an AI phone-call automation system.

Your job is to classify whether a user message requires calling a real-world business, and if so, categorize it into structured intent fields.

You MUST return valid JSON only. No explanation outside JSON.

### STEP 1 — Determine if the user request requires calling a business.
If the task can be solved with simple information lookup or casual chat, requires_call = false.

### STEP 2 — If requires_call = true, classify into:

Domains:
- pet_services
- healthcare
- dmv
- utilities
- insurance
- internet_provider
- restaurant
- general_business
- unknown

Tasks (choose the one that BEST matches what the user wants to achieve on the call):
- price_comparison — User wants to ask for a price, quote, or cost (e.g. "ask for cat neuter price", "how much for X", "get a quote", "what does it cost"). Use this when the primary goal is to learn the price/cost of a service or product.
- appointment_booking — User wants to schedule, book, or reschedule an appointment (e.g. "book a visit", "reschedule my appointment", "schedule for next week"). Do NOT use for price inquiries.
- service_cancellation — User wants to cancel a service or appointment.
- availability_check — User wants to know when something is available (e.g. "when are you open", "do you have slots").
- claim_status — User wants to check status of a claim.
- information_lookup — General questions (hours, location, what services you offer) that are not mainly about price or booking.
- other — None of the above.

### OUTPUT FORMAT (STRICT JSON):

{
  "requires_call": boolean,
  "domain": string,
  "task": string,
  "confidence": number_between_0_and_1,
  "reasoning": "short explanation"
}

Rules:
- If the user message is about asking for a PRICE, QUOTE, or COST, use task = "price_comparison". Do not use appointment_booking for price inquiries.
- If uncertain, lower confidence below 0.7.
- If clearly general conversation, requires_call = false.
- Never hallucinate business names.
- Never include text outside JSON.`;

const VALID_DOMAINS = new Set([
  "pet_services",
  "healthcare",
  "dmv",
  "utilities",
  "insurance",
  "internet_provider",
  "restaurant",
  "general_business",
  "unknown",
]);
const VALID_TASKS = new Set([
  "price_comparison",
  "appointment_booking",
  "service_cancellation",
  "availability_check",
  "claim_status",
  "information_lookup",
  "other",
]);

/**
 * Classify intent of a user message (e.g. call reason) for Holdless.
 * Runs before every outbound call. Returns { requires_call, domain, task, confidence, reasoning } or null on failure.
 */
async function classifyIntent(userMessage) {
  if (!userMessage || typeof userMessage !== "string") return null;
  const trimmed = userMessage.trim();
  if (!trimmed) return null;
  if (!openai) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
        { role: "user", content: trimmed },
      ],
      max_tokens: 256,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const requires_call = Boolean(parsed.requires_call);
    const domain = VALID_DOMAINS.has(parsed.domain) ? parsed.domain : "unknown";
    const task = VALID_TASKS.has(parsed.task) ? parsed.task : "other";
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;
    const reasoning =
      typeof parsed.reasoning === "string"
        ? parsed.reasoning.trim().slice(0, 500)
        : "";
    return { requires_call, domain, task, confidence, reasoning };
  } catch (err) {
    console.warn("[Intent] classification failed:", err.message);
    return null;
  }
}

const SYSTEM_PROMPT = `You are a helpful AI customer service assistant for Holdless. You CAN make outbound phone calls for users—this is a core feature.

CALL RULES (highest priority):
- Before placing ANY call, you MUST first confirm with the user. Reply with a short summary: who you will call (phone number) and what you will ask (reason). Then ask: "Should I proceed with the call? (Yes/No)". Do NOT use place_call until the user replies Yes (or similar confirmation).
- Only after the user confirms (e.g. "Yes", "Go ahead", "Please do") may you use place_call with that number and reason.
- Do NOT use search_places for call requests. Phone numbers are for calling, not searching.
- When they say "that number" or "them", get the number from the CONVERSATION HISTORY.
- Extract: phone number (add +1 for US 10-digit) and call reason. First ask for confirmation; after they say Yes, then call.

SEARCH RULES (only when user wants to find places, not call):
- When the user asks to search for places (e.g. "search nearby hospital in 90024", "find coffee shops in 90210"), use search_places.

PHONE LOOKUP (when user wants a place's phone number by address or name):
- When the user asks for a place's phone number (e.g. "what's the phone number for 123 Main St?", "get me the number for Starbucks in 90024", "phone number for [address]"), first use search_places with the address or "place name in location", then use get_place_phone with the place_id of the best matching result. If multiple places are returned, use the first result unless the user specified a name. Then you can offer to call that number (and ask for confirmation before calling).`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_places",
      description:
        'Search for places on Google Maps. Use when the user wants to find nearby places (e.g. "search hospital in 90024", "find coffee shops in 90210") OR when they ask for a place\'s phone number by address/name—then use get_place_phone with the returned place_id.',
      parameters: {
        type: "object",
        properties: {
          text_query: {
            type: "string",
            description:
              'Natural language search query including place type and/or location, e.g. "hospital in 90024", "Starbucks at 123 Main St 90024", "123 Main Street Los Angeles"',
          },
        },
        required: ["text_query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_place_phone",
      description:
        'Get the phone number (and address) for a place by its place_id. Use AFTER search_places when the user asks for a place\'s phone number (e.g. "phone number for 123 Main St", "what\'s the number for that restaurant"). Pass the place_id from the search_places result.',
      parameters: {
        type: "object",
        properties: {
          place_id: {
            type: "string",
            description:
              "The place_id from a previous search_places result (e.g. ChIJN1t_tDeuEmsRUsoyG83frY4)",
          },
        },
        required: ["place_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_call",
      description:
        'Place an outbound phone call. Use ONLY after the user has confirmed (e.g. replied Yes to "Should I proceed with the call?"). First message: reply with a summary (number, reason) and ask Yes/No. Second message after Yes: use place_call with the number and reason from the conversation.',
      parameters: {
        type: "object",
        properties: {
          phone_number: {
            type: "string",
            description:
              "The phone number to call. Use E.164 format: +1XXXXXXXXXX for US numbers. Example: +19452644540",
          },
          call_reason: {
            type: "string",
            description:
              'The reason or purpose for the call, e.g. "ask for the price of cat neuter service", "return damaged strawberries", "request refund for order". The backend will receive a summarized version (under 500 chars) of the full chat as the purpose.',
          },
          voice_preference: {
            type: "string",
            description:
              "Optional. Voice preference for the call (e.g. male, female, neutral).",
          },
          additional_instructions: {
            type: "string",
            description: "Optional. Extra instructions for the call.",
          },
        },
        required: ["phone_number", "call_reason"],
      },
    },
  },
];

/**
 * Google Places Text Search (Legacy).
 * GET .../place/textsearch/json?query=...&key=...
 * Requires Places API to be enabled on the API key.
 */
async function searchPlaces(textQuery) {
  if (!GOOGLE_PLACES_API_KEY) {
    return {
      error:
        "Google Places API key not configured. Add GOOGLE_PLACES_API_KEY to .env.",
    };
  }
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/textsearch/json",
  );
  url.searchParams.set("query", textQuery);
  url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return {
      error: data.error_message || data.status || "Places request failed",
    };
  }

  const rawPlaces = (data.results || []).slice(0, 5);
  const places = await Promise.all(
    rawPlaces.map(async (p) => {
      const base = {
        place_id: p.place_id,
        name: p.name,
        address: p.formatted_address,
        rating: p.rating,
        open_now: p.opening_hours?.open_now,
      };
      const details = await getPlaceDetails(p.place_id);
      if (
        !details.error &&
        (details.formatted_phone_number || details.international_phone_number)
      ) {
        base.phone_number =
          details.formatted_phone_number ||
          details.international_phone_number ||
          null;
        base.formatted_phone_number = details.formatted_phone_number || null;
        base.international_phone_number =
          details.international_phone_number || null;
      }
      return base;
    }),
  );

  return { query: textQuery, places, total: data.results?.length ?? 0 };
}

/**
 * Google Place Details (Legacy) – get phone and other contact info for a place_id.
 * GET .../place/details/json?place_id=...&fields=...&key=...
 * Contact fields (e.g. formatted_phone_number) are billed under the Contact SKU.
 */
async function getPlaceDetails(placeId) {
  if (!GOOGLE_PLACES_API_KEY) {
    return {
      error:
        "Google Places API key not configured. Add GOOGLE_PLACES_API_KEY to .env.",
    };
  }
  if (!placeId || typeof placeId !== "string") {
    return { error: "place_id is required" };
  }
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json",
  );
  url.searchParams.set("place_id", placeId.trim());
  url.searchParams.set(
    "fields",
    "name,formatted_address,formatted_phone_number,international_phone_number",
  );
  url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK") {
    return {
      error:
        data.error_message || data.status || "Place Details request failed",
    };
  }

  const r = data.result || {};
  return {
    place_id: placeId,
    name: r.name,
    formatted_address: r.formatted_address,
    formatted_phone_number: r.formatted_phone_number || null,
    international_phone_number: r.international_phone_number || null,
  };
}

/**
 * Normalize phone to E.164 (US: +1 + 10 digits). Shared by both call backends.
 */
function normalizePhoneE164(phoneNumber) {
  let digits = String(phoneNumber).replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  else if (digits.length > 11 && digits.startsWith("1"))
    digits = digits.slice(0, 11);
  else if (digits.length === 11 && !digits.startsWith("1"))
    digits = "1" + digits.slice(0, 10);
  else if (digits.length !== 11 || !digits.startsWith("1"))
    digits = "1" + digits.slice(-10);
  return "+" + digits;
}

/**
 * Place outbound call via GPT-4o Realtime call backend.
 * Returns { callId, status, callReason, message } or { error }.
 * @param {object} [options] - Optional. { voice_preference, additional_instructions }.
 */
async function placeCall(
  phoneNumber,
  callReason,
  callBackendToken,
  options = {},
) {
  const normalized = normalizePhoneE164(phoneNumber);
  console.log(
    "[Call] placeCall start | phone:",
    normalized,
    "| reason:",
    callReason?.slice(0, 60),
  );

  if (!USE_CALL_BACKEND) {
    console.log("[Call] placeCall abort: Realtime call backend not configured");
    return {
      error:
        "Calls not configured. Set CALL_BACKEND_URL (and optionally CALL_API_TOKEN or sign in for calls).",
    };
  }
  const token = (callBackendToken || "").trim() || CALL_API_TOKEN;
  if (!token && !CALL_BACKEND_ALLOW_NO_AUTH) {
    return {
      error:
        "Call backend requires authentication. Set CALL_API_TOKEN in .env (e.g. your backend API key), or CALL_BACKEND_ALLOW_NO_AUTH=true if your backend needs no auth.",
    };
  }
  return placeCallViaBackend(normalized, callReason, token, options);
}

/**
 * Place call via GPT-4o Realtime call backend: POST /api/calls with snake_case body.
 * Body: { phone_number, purpose } plus optional voice_preference, additional_instructions.
 * @param {string} token - Optional. Bearer token (from request or CALL_API_TOKEN). Omitted when empty and CALL_BACKEND_ALLOW_NO_AUTH is set.
 * @param {object} [options] - Optional. { voice_preference, additional_instructions }.
 */
async function placeCallViaBackend(
  phoneNumber,
  callReason,
  token,
  options = {},
) {
  const url = `${CALL_BACKEND_URL}/api/calls`;
  const rawPurpose = (callReason || "").trim() || "Customer inquiry";
  const purpose = (await translateToEnglish(rawPurpose)).slice(
    0,
    PURPOSE_SUMMARY_MAX_LENGTH,
  );
  // Intent classification runs before every call (domain, task, confidence for routing/tagging).
  const intent = await classifyIntent(callReason || purpose);
  if (intent) {
    console.log(
      "[Call] intent classification:",
      intent.domain,
      intent.task,
      "confidence:",
      intent.confidence,
    );
  }
  const body = {
    phone_number: phoneNumber,
    purpose,
    ...(intent && { intent }),
    ...(options.voice_preference != null &&
      String(options.voice_preference).trim() && {
        voice_preference: String(options.voice_preference).trim(),
      }),
    ...(options.additional_instructions != null &&
      String(options.additional_instructions).trim() && {
        additional_instructions: String(options.additional_instructions).trim(),
      }),
  };
  const timeoutMs = Number(process.env.CALL_BACKEND_TIMEOUT_MS) || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers = { "Content-Type": "application/json" };
  if ((token || "").trim()) headers.Authorization = `Bearer ${token.trim()}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }

    console.log(
      "[Call] backend placeCall response | status:",
      res.status,
      "| body:",
      text?.slice(0, 200) || "(empty)",
    );

    if (!res.ok) {
      let errMsg =
        data.error ||
        data.message ||
        text ||
        `Call backend error: ${res.status}`;
      if (res.status === 404 && (text || "").includes("/api/calls")) {
        console.warn(
          "[Call] 404 on POST /api/calls – CALL_BACKEND_URL must point to the separate call backend (the service that implements POST /api/calls), not this chat server. Example: CALL_BACKEND_URL=http://localhost:4000",
        );
        errMsg =
          "Call backend not found (404). Set CALL_BACKEND_URL to the URL of the service that places calls (e.g. http://localhost:4000), not the chat server. See SETUP.md.";
      }
      return { error: errMsg };
    }

    if (!data.call || !data.call.id) {
      return {
        error: data.message || "Call backend did not return a call id.",
      };
    }

    const call = data.call;
    console.log(
      "[Call] backend placeCall success | callId:",
      call.id,
      "| status:",
      call.status,
    );
    return {
      callId: call.id,
      status: call.status || "queued",
      callReason: call.purpose || callReason,
      domain: intent?.domain ?? "unknown",
      task: intent?.task,
      message:
        data.message ||
        "Call initiated. You can watch the live transcript below.",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[Call] backend placeCall exception:", err.name, err.message);
    const isTimeout = err.name === "AbortError";
    return {
      error: isTimeout
        ? "Call backend request timed out. Please try again in a moment."
        : err.message || "Failed to place call",
    };
  }
}

/**
 * Fetch call status and transcript from GPT-4o Realtime call backend (when configured).
 * Returns { id, status, transcript: [...], startedAt?, endedAt?, cost? } or { error }.
 * @param {string} callBackendToken - Optional; from request or CALL_API_TOKEN.
 */
async function getCallStatus(callId, callBackendToken) {
  if (!USE_CALL_BACKEND) {
    return { error: "Call backend not configured. Set CALL_BACKEND_URL." };
  }
  const token = (callBackendToken || "").trim() || CALL_API_TOKEN;
  if (!token && !CALL_BACKEND_ALLOW_NO_AUTH) {
    return {
      error:
        "Call backend requires authentication. Set CALL_API_TOKEN or CALL_BACKEND_ALLOW_NO_AUTH=true.",
    };
  }
  return getCallStatusFromBackend(callId, token);
}

/**
 * Normalize backend transcript array to [{ role: 'customer'|'ai', content, timestamp }].
 * Accepts various shapes: { role, content, timestamp }, { speaker, text, timestamp }, etc.
 */
function normalizeTranscript(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const role =
        m.role === "user" ||
        m.role === "customer" ||
        m.speaker === "user" ||
        m.speaker === "customer"
          ? "customer"
          : "ai";
      const content = m.content ?? m.message ?? m.text ?? "";
      const timestamp = m.timestamp ?? m.created_at ?? null;
      return { role, content: String(content), timestamp };
    });
}

/**
 * GET call status and transcript from GPT-4o Realtime call backend.
 * Retries on connection failure (e.g. call backend not ready right after place_call).
 * @param {string} token - Optional. Bearer token (from request or CALL_API_TOKEN). Omitted when empty and CALL_BACKEND_ALLOW_NO_AUTH.
 */
async function getCallStatusFromBackend(callId, token) {
  const url = `${CALL_BACKEND_URL}/api/calls/${callId}`;
  const timeoutMs = Number(process.env.CALL_BACKEND_TIMEOUT_MS) || 10000;
  const maxRetries = 3;
  const retryDelaysMs = [0, 500, 1500];

  const headers = {};
  if ((token || "").trim()) headers.Authorization = `Bearer ${token.trim()}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        data = {};
      }

      if (!res.ok) {
        const errMsg =
          data.error ||
          data.message ||
          text ||
          `Call backend error: ${res.status}`;
        if (res.status === 404) return { error: "Call not found" };
        return { error: errMsg };
      }

      const call = data.call || data;
      const rawTranscript =
        data.transcript ?? call.transcript ?? data.transcript_lines ?? [];
      const transcript = normalizeTranscript(
        Array.isArray(rawTranscript)
          ? rawTranscript
          : (rawTranscript?.lines ?? []),
      );

      return {
        id: call.id ?? callId,
        status: call.status ?? "unknown",
        transcript,
        startedAt: call.started_at ?? call.startedAt ?? call.created_at,
        endedAt: call.ended_at ?? call.endedAt ?? call.completed_at,
        cost: call.cost,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const cause =
        err.cause && typeof err.cause === "object" ? err.cause : null;
      const code = cause?.code ?? err.code;
      console.error(
        "[Call] getCallStatusFromBackend exception | callId:",
        callId,
        "| attempt:",
        attempt + 1,
        "|",
        err.name,
        err.message,
        code ? `| cause.code: ${code}` : "",
        cause?.message ? `| cause: ${cause.message}` : "",
      );
      const isTimeout = err.name === "AbortError";
      const isConnectionError =
        code === "ECONNREFUSED" ||
        code === "ECONNRESET" ||
        code === "ENOTFOUND" ||
        err.message === "fetch failed";
      if (isConnectionError && attempt < maxRetries - 1) {
        continue;
      }
      return {
        error: isTimeout
          ? "Call backend request timed out."
          : err.message || "Failed to fetch call status",
      };
    }
  }

  return { error: "Failed to fetch call status after retries." };
}

/**
 * POST /api/intent/classify — Test intent classification without placing a call.
 * Body: { message: string }. Returns { intent: { requires_call, domain, task, confidence, reasoning } } or { error }.
 */
app.post("/api/intent/classify", async (req, res) => {
  const message =
    req.body?.message != null ? String(req.body.message).trim() : "";
  if (!message) {
    return res.status(400).json({
      error: "message is required",
      hint: 'Send JSON body: { "message": "your user message here" }',
    });
  }
  if (!openai) {
    return res.status(503).json({
      error: "OPENAI_API_KEY not set. Intent classification requires OpenAI.",
    });
  }
  try {
    const intent = await classifyIntent(message);
    if (!intent) {
      return res
        .status(500)
        .json({ error: "Intent classification failed (parse or API error)." });
    }
    return res.json({ message, intent });
  } catch (err) {
    console.error("[Intent] /api/intent/classify error:", err.message);
    return res
      .status(500)
      .json({ error: err.message || "Intent classification failed." });
  }
});

app.post("/api/chat", async (req, res) => {
  // Log request shape so we can see if Python-style (user_id, message, conversation_id) hit Node
  const bodyKeys =
    req.body && typeof req.body === "object" ? Object.keys(req.body) : [];
  const hasMessages =
    Array.isArray(req.body?.messages) && req.body.messages.length > 0;
  const hasPythonShape =
    "user_id" in (req.body || {}) && "message" in (req.body || {});
  console.log(
    "[Chat] POST /api/chat received | bodyKeys:",
    bodyKeys.join(", "),
    "| hasMessages:",
    hasMessages,
    "| hasPythonShape:",
    hasPythonShape,
  );

  // When frontend sends Python-shaped body (state-machine chat + Supabase persistence), proxy to Python.
  // If CONFIRMED with hospital_phone, place the call via call backend and add callId to task.
  if (
    hasPythonShape &&
    (!Array.isArray(req.body?.messages) || req.body.messages.length === 0)
  ) {
    console.log(
      "[Chat] Proxying Python-shaped POST /api/chat to Python backend for persistence.",
    );
    const url = PYTHON_BACKEND_URL + req.originalUrl;
    const headers = { ...req.headers, host: undefined };
    const opts = { method: req.method, headers };
    opts.body = JSON.stringify(req.body || {});
    if (!headers["content-type"]) headers["Content-Type"] = "application/json";
    fetch(url, opts)
      .then(async (p) => {
        const text = await p.text();
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }
        if (
          p.ok &&
          data.debug_state === "CONFIRMED" &&
          data.hospital_phone &&
          data.task_id &&
          USE_CALL_BACKEND
        ) {
          const callReason = data.call_reason || "Veterinary price inquiry";
          const token = getCallBackendToken(req);
          const userId = req.body?.user_id || "";
          const taskId = data.task_id;
          console.log(
            "[Chat] CONFIRMED with hospital_phone, placing call via call backend",
            { taskId, phone: data.hospital_phone },
          );
          const callResult = await placeCall(
            data.hospital_phone,
            callReason,
            token,
          );
          if (callResult.callId && !callResult.error) {
            data.callId = callResult.callId;
            data.callReason = callResult.callReason || callReason;
            data.domain = callResult.domain ?? "unknown";
            console.log(
              "[Chat] Call placed, updating task with callId",
              callResult.callId,
            );
            try {
              const patchUrl = `${PYTHON_BACKEND_URL}/api/tasks/${taskId}?user_id=${encodeURIComponent(userId)}`;
              await fetch(patchUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  payload: {
                    type: "call",
                    callId: callResult.callId,
                    callReason: data.callReason,
                    title: data.domain,
                    description: data.callReason,
                    vendor: "Phone Call",
                  },
                }),
              });
            } catch (patchErr) {
              console.warn(
                "[Chat] Failed to update task with callId:",
                patchErr?.message,
              );
            }
          } else if (callResult.error) {
            console.warn("[Chat] placeCall failed:", callResult.error);
          }
        }
        res.status(p.status);
        p.headers.forEach((v, k) => {
          if (k.toLowerCase() !== "transfer-encoding") res.setHeader(k, v);
        });
        res.send(typeof data === "object" ? JSON.stringify(data) : text);
      })
      .catch((err) => {
        console.error(
          "[Python proxy]",
          req.method,
          req.originalUrl,
          err.message,
        );
        res
          .status(502)
          .json({ error: "Python backend unavailable", detail: err.message });
      });
    return;
  }

  if (!openai) {
    return res.status(503).json({
      error: "Chat API not configured",
      message: "Set OPENAI_API_KEY in .env to enable ChatGPT.",
    });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  const callBackendToken = getCallBackendToken(req);
  const fromHeader = req.headers?.authorization?.startsWith("Bearer ");
  const fromBody = !!(
    req.body?.callBackendToken && String(req.body.callBackendToken).trim()
  );
  console.log(
    "[Chat] callBackendToken received:",
    !!callBackendToken,
    "| from: header=",
    fromHeader,
    "body=",
    fromBody,
    "env=",
    !!CALL_API_TOKEN,
  );

  const openaiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    })),
  ];

  // Detect call request: "call" + number, or "call that number", "help me call", etc.
  const lastUserContent = (messages[messages.length - 1]?.content || "").trim();
  const hasPhoneNumber = /\d{7,}/.test(lastUserContent); // 7+ digits
  const hasCallWord = /\bcall\b/i.test(lastUserContent);
  const hasCallPhrase =
    /call\s+(?:that\s+)?number|help\s+me\s+call|(?:can\s+)?(?:u|you)\s+call|just\s+(?:help\s+me\s+)?call|call\s+(?:\d|[\d\s\-\(\)]{7,})/i.test(
      lastUserContent,
    );
  // If "call" + phone number in same message, or any call phrase → treat as call request
  const callBackendAvailable = !!USE_CALL_BACKEND;
  const hasCallRequest =
    callBackendAvailable && ((hasCallWord && hasPhoneNumber) || hasCallPhrase);

  console.log("[Call] lastUserContent:", lastUserContent.slice(0, 80));
  console.log("[Call] call detection:", {
    hasPhoneNumber,
    hasCallWord,
    hasCallPhrase,
    callBackendAvailable,
    CALL_BACKEND_URL_set: !!CALL_BACKEND_URL,
    hasCallRequest,
  });

  // When call requested: pass ONLY place_call so model can confirm first, then call after user says Yes (use 'auto', do not force)
  const toolsToUse = hasCallRequest
    ? TOOLS.filter((t) => t.function.name === "place_call")
    : GOOGLE_PLACES_API_KEY || callBackendAvailable
      ? TOOLS
      : undefined;
  const toolChoice = toolsToUse ? "auto" : undefined;

  try {
    console.log(
      "[Chat] OpenAI request | tools:",
      toolsToUse?.map((t) => t.function.name) || "none",
      "| toolChoice:",
      JSON.stringify(toolChoice),
    );
    let completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: openaiMessages,
      max_tokens: 1024,
      tools: toolsToUse,
      tool_choice: toolChoice,
    });

    let message = completion.choices?.[0]?.message;
    const toolCallNames =
      message?.tool_calls?.map((tc) => tc.function?.name) || [];
    const contentPreview = message?.content?.trim().slice(0, 120) || "(none)";
    console.log(
      "[Chat] OpenAI first response | tool_calls:",
      toolCallNames.length ? toolCallNames : "none",
      "| contentPreview:",
      contentPreview,
    );
    if (message?.content?.trim() && !message?.tool_calls?.length) {
      console.log(
        "[Chat] Model returned TEXT instead of tool_calls. Full content (first 400 chars):",
        message.content.trim().slice(0, 400),
      );
      // In call-request flow, prepend "Description: {purpose}" (same as backend) for confirmation
      if (hasCallRequest) {
        const purpose = await summarizeChatToPurpose(
          openaiMessages,
          message.content?.trim() || lastUserContent,
        );
        message = {
          ...message,
          content: `Description: ${purpose}\n\n${(message.content || "").trim()}`,
        };
        console.log(
          "[Chat] Confirmation message includes Description (purpose length):",
          purpose.length,
        );
      }
      if (
        /unable to make|personal calls|cannot make calls/i.test(message.content)
      ) {
        console.log(
          "[Chat] *** Model refused to place call (disclaimer text). hasCallRequest was:",
          hasCallRequest,
          "| toolChoice was:",
          JSON.stringify(toolChoice),
        );
      }
    }

    let lastCallId = null;
    let lastCallReason = null;
    let lastCallDomain = null;
    let placeCallAlreadyInvoked = false;

    // Handle tool calls (e.g. search_places, place_call) - place_call only once per request
    while (message?.tool_calls?.length) {
      const toolCall = message.tool_calls[0];
      const name = toolCall.function?.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || "{}");
      } catch (_) {}

      openaiMessages.push(message);
      let toolResult;

      if (name === "search_places" && args.text_query) {
        const searchResult = await searchPlaces(String(args.text_query).trim());
        toolResult = JSON.stringify(searchResult);
      } else if (name === "get_place_phone" && args.place_id) {
        const detailsResult = await getPlaceDetails(
          String(args.place_id).trim(),
        );
        toolResult = JSON.stringify(detailsResult);
      } else if (
        name === "place_call" &&
        args.phone_number &&
        args.call_reason
      ) {
        if (placeCallAlreadyInvoked) {
          toolResult = JSON.stringify({
            error:
              "A call was already placed for this request. Do not place another.",
          });
          console.log(
            "[Call] place_call skipped (already invoked once this request)",
          );
        } else {
          placeCallAlreadyInvoked = true;
          const purpose = await summarizeChatToPurpose(
            openaiMessages,
            args.call_reason,
          );
          const callOptions = {};
          if (
            args.voice_preference != null &&
            String(args.voice_preference).trim()
          )
            callOptions.voice_preference = String(args.voice_preference).trim();
          if (
            args.additional_instructions != null &&
            String(args.additional_instructions).trim()
          )
            callOptions.additional_instructions = String(
              args.additional_instructions,
            ).trim();
          console.log(
            "[Call] place_call invoked | phone:",
            args.phone_number,
            "| purpose length:",
            purpose.length,
          );
          const callResult = await placeCall(
            args.phone_number,
            purpose,
            callBackendToken,
            callOptions,
          );
          console.log(
            "[Call] place_call result:",
            callResult.callId
              ? { callId: callResult.callId, status: callResult.status }
              : { error: callResult.error },
          );
          if (callResult.callId) {
            lastCallId = callResult.callId;
            lastCallReason = callResult.callReason || purpose;
            lastCallDomain = callResult.domain ?? null;
          }
          toolResult = JSON.stringify(callResult);
        }
      } else {
        toolResult = JSON.stringify({ error: "Unknown or invalid tool call" });
      }

      openaiMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });

      // After place_call, stop offering it so model won't retry
      const nextTools = placeCallAlreadyInvoked
        ? toolsToUse?.filter((t) => t.function.name !== "place_call")
        : toolsToUse;
      const nextToolChoice = placeCallAlreadyInvoked
        ? "auto"
        : toolChoice || "auto";

      completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: openaiMessages,
        max_tokens: 1024,
        tools: nextTools,
        tool_choice: nextToolChoice,
      });
      message = completion.choices?.[0]?.message;
    }

    const content =
      message?.content?.trim() ||
      "I'm not sure how to respond. Could you tell me more?";
    const response = { content };
    if (lastCallId) {
      response.callId = lastCallId;
      if (lastCallReason) response.callReason = lastCallReason;
      if (lastCallDomain) response.domain = lastCallDomain;
    }
    console.log(
      "[Chat] sending response | callId:",
      lastCallId || "(none)",
      "| callReason:",
      lastCallReason || "(none)",
      "| domain:",
      lastCallDomain || "(none)",
      "| placeCallInvoked:",
      placeCallAlreadyInvoked,
      "| contentLen:",
      content?.length,
    );
    return res.json(response);
  } catch (err) {
    console.error(
      "[Chat] OpenAI/request error:",
      err.message,
      err.stack?.split("\n").slice(0, 3),
    );
    const status = err.status || 502;
    return res.status(status).json({
      error: "Chat request failed",
      message: err.message || "OpenAI request failed.",
    });
  }
});

// GET /api/call/:callId - Fetch call status and transcript (for live transcript polling). Send Authorization: Bearer <jwt>.
app.get("/api/call/:callId", async (req, res) => {
  const { callId } = req.params;
  if (!callId) {
    return res.status(400).json({ error: "callId required" });
  }
  const callBackendToken =
    req.headers?.authorization &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : CALL_API_TOKEN;
  const result = await getCallStatus(callId, callBackendToken);
  if (result.error) {
    return res.status(502).json(result);
  }
  return res.json(result);
});

/**
 * POST /api/call/:callId/summarize — AI summarization of a call with respect to its purpose.
 * Uses transcript from body.transcript if provided; otherwise fetches from call backend (with retries when empty).
 * Body: { purpose?: string, transcript?: string }. Auth: Bearer <token> (same as GET /api/call/:callId).
 * Returns { summary: string } or { error }.
 */
app.post("/api/call/:callId/summarize", async (req, res) => {
  const { callId } = req.params;
  if (!callId) {
    return res.status(400).json({ error: "callId required" });
  }
  const callBackendToken =
    req.headers?.authorization &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : CALL_API_TOKEN;
  const purpose =
    typeof req.body?.purpose === "string"
      ? req.body.purpose.trim()
      : "";
  const bodyTranscript =
    typeof req.body?.transcript === "string"
      ? req.body.transcript.trim()
      : "";

  let transcriptText = bodyTranscript;

  if (!transcriptText) {
    const delays = [0, 1000, 3000, 6000];
    for (const delayMs of delays) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const statusResult = await getCallStatus(callId, callBackendToken);
      if (statusResult.error) {
        if (delayMs === delays[delays.length - 1]) {
          return res.status(502).json({ error: statusResult.error });
        }
        continue;
      }
      const transcript = statusResult.transcript || [];
      transcriptText =
        transcript
          .map((m) => `${m.role === "customer" ? "Customer" : "Agent"}: ${m.content}`)
          .join("\n") || "";
      if (transcriptText) break;
    }
  }

  if (!transcriptText || !transcriptText.trim()) {
    return res.status(200).json({
      summary:
        "No transcript available for this call. Summary will appear after the call is processed.",
    });
  }

  if (!openai) {
    return res.status(503).json({
      error: "OPENAI_API_KEY not set. Summarization requires OpenAI.",
    });
  }

  try {
    const systemPrompt =
      "You are a concise call analyst. Summarize and analyze the call transcript with respect to the caller's purpose. " +
      "Focus on: key facts (e.g. prices, dates, policies), comparisons if multiple options were discussed (e.g. 'Clinic A is $200, the cheapest; Clinic B is relatively expensive'), and the outcome or next steps. " +
      "Write 1–3 short sentences in plain English. Be specific with numbers and names when mentioned.";
    const userContent =
      (purpose
        ? `Call purpose: ${purpose}\n\nTranscript:\n${transcriptText}`
        : `Transcript:\n${transcriptText}`) +
      "\n\nProvide a brief summary and analysis with respect to the purpose above.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 400,
      temperature: 0.3,
    });
    const summary =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "Unable to generate summary.";
    return res.json({ summary });
  } catch (err) {
    console.error("[Call] summarize error:", err.message);
    return res.status(500).json({
      error: err.message || "Summarization failed.",
    });
  }
});

// GET /api/calls/:callId/transcripts - Fetch full transcript records for a call (call backend). Auth: Bearer <token>.
app.get("/api/calls/:callId/transcripts", async (req, res) => {
  const { callId } = req.params;
  if (!callId) {
    return res.status(400).json({ error: "callId required" });
  }
  if (!USE_CALL_BACKEND) {
    return res
      .status(503)
      .json({ error: "Call backend not configured. Set CALL_BACKEND_URL." });
  }
  const token =
    req.headers?.authorization &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : CALL_API_TOKEN;
  if (!token && !CALL_BACKEND_ALLOW_NO_AUTH) {
    return res.status(401).json({
      error: "Authorization required. Send Bearer token or set CALL_API_TOKEN.",
    });
  }
  const url = `${CALL_BACKEND_URL}/api/calls/${callId}/transcripts`;
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const backendRes = await fetch(url, { headers });
    const text = await backendRes.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    res.status(backendRes.status);
    res.setHeader("Content-Type", "application/json");
    res.send(
      backendRes.ok
        ? text
        : JSON.stringify(
            data?.error
              ? data
              : { error: data.message || text || "Transcripts request failed" },
          ),
    );
  } catch (err) {
    console.error(
      "[Call] GET /api/calls/:callId/transcripts error:",
      err.message,
    );
    res
      .status(502)
      .json({ error: "Call backend unavailable", detail: err.message });
  }
});

function tryListen(port) {
  const server = app.listen(port, () => {
    console.log(`Chat server running at http://localhost:${port}`);
    if (port !== PORT) {
      console.warn(
        `Port ${PORT} was in use; using ${port}. Set VITE_API_TARGET=${port} in .env and restart the Vite dev server so the frontend hits this chat server.`,
      );
    }
    if (!openai) {
      console.warn(
        "OPENAI_API_KEY not set – /api/chat will return 503 until you add it to .env",
      );
    }
    if (!GOOGLE_PLACES_API_KEY) {
      console.warn(
        'GOOGLE_PLACES_API_KEY not set – map search (e.g. "hospital in 90024") will not be available',
      );
    }
    if (USE_CALL_BACKEND) {
      console.log(
        "Calls: GPT-4o Realtime call backend at",
        CALL_BACKEND_URL,
        CALL_API_TOKEN ? "(env token)" : "(use sign-in token)",
      );
    } else {
      console.warn(
        "Outbound calls disabled. Set CALL_BACKEND_URL (token from frontend sign-in or CALL_API_TOKEN).",
      );
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1);
    } else {
      throw err;
    }
  });
}

tryListen(PORT);
