import { describe, expect, it } from "vitest";
import {
  messagesSuggestNodeOpenAiCallFlow,
  resolveChatBackend,
  shouldUsePythonBackend,
} from "./chatBackendRouting";

describe("messagesSuggestNodeOpenAiCallFlow", () => {
  it("detects Node-only name prompt", () => {
    expect(
      messagesSuggestNodeOpenAiCallFlow([
        {
          role: "assistant",
          content: "What name should I use for the call? Your profile name is Yan.",
        },
      ]),
    ).toBe(true);
  });

  it("does not match Python-only confirm wording", () => {
    expect(
      messagesSuggestNodeOpenAiCallFlow([
        {
          role: "assistant",
          content: "Should I proceed with the call? (Yes/No)",
        },
      ]),
    ).toBe(false);
  });
});

describe("resolveChatBackend", () => {
  const nodeThread = [
    {
      role: "assistant",
      content:
        "What name should I use for the call? Your profile name is Yan, or type a different name.",
    },
    {
      role: "assistant",
      content: "Should I proceed with the call? (Yes/No)",
    },
  ];

  it("keeps Node thread on Node even without a Python conversation id", () => {
    expect(resolveChatBackend(null, null, nodeThread)).toBe("node");
  });

  it("does not misroute Node confirm text alone to Python", () => {
    expect(
      shouldUsePythonBackend(null, null, [
        { role: "assistant", content: "Should I proceed with the call? (Yes/No)" },
      ]),
    ).toBe(false);
  });

  it("uses Python when a conversation id exists and Node phrasing is absent", () => {
    expect(
      resolveChatBackend(null, "conv-123", [
        { role: "assistant", content: "Should I proceed with the call? (Yes/No)" },
      ]),
    ).toBe("python");
  });

  it("honors explicit backend override", () => {
    expect(resolveChatBackend("python", null, nodeThread)).toBe("python");
    expect(resolveChatBackend("node", "conv-123", [])).toBe("node");
  });
});
