/** Helpers for Node OpenAI call name → confirm → place_call flow. */

export const AFFIRMATIVE_REPLY_RE =
  /^(yes|y|yeah|yep|sure|please|please do|ok|okay|confirm|correct|go ahead)$/i;

export function isAffirmativeReply(msg) {
  return AFFIRMATIVE_REPLY_RE.test(String(msg || "").trim());
}

export function getLastAssistantMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return null;
}

/** True when the thread is in (or completed) the Node call name → confirm → place flow. */
export function conversationInCallPlacementFlow(messages) {
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    const content = String(m.content || "");
    if (m.role === "user" && /\bcall\b/i.test(content) && /\d{7,}/.test(content)) {
      return true;
    }
    if (m.role === "assistant") {
      if (/What name should I use for the call/i.test(content)) return true;
      if (/Should I proceed with the call/i.test(content)) return true;
      if (/^Purpose:/im.test(content)) return true;
    }
  }
  return false;
}

export function userConfirmingPendingCall(messages, lastUserContent) {
  const lastAssistant = getLastAssistantMessage(messages);
  if (!lastAssistant) return false;
  return (
    /Should I proceed with the call/i.test(lastAssistant.content || "") &&
    isAffirmativeReply(lastUserContent)
  );
}
