/** Which chat backend should handle follow-up messages in a thread. */

export type ChatBackend = "python" | "node";

export type ChatMessageLike = { role: string; content: string };

/** Node OpenAI call flow uses this phrasing; Python state machine does not. */
export function messagesSuggestNodeOpenAiCallFlow(msgs: ChatMessageLike[]): boolean {
  return msgs.some(
    (m) =>
      m.role === "assistant" &&
      /What name should I use for the call/i.test(m.content),
  );
}

export function resolveChatBackend(
  explicit: ChatBackend | null,
  pythonConversationId: string | null,
  msgs: ChatMessageLike[],
  historyConversationId?: string | null,
): ChatBackend {
  if (explicit === "node") return "node";
  if (explicit === "python") return "python";
  if (messagesSuggestNodeOpenAiCallFlow(msgs)) return "node";
  if (pythonConversationId || historyConversationId) return "python";
  return "node";
}

export function shouldUsePythonBackend(
  explicit: ChatBackend | null,
  pythonConversationId: string | null,
  msgs: ChatMessageLike[],
  historyConversationId?: string | null,
): boolean {
  return (
    resolveChatBackend(
      explicit,
      pythonConversationId,
      msgs,
      historyConversationId,
    ) === "python"
  );
}
