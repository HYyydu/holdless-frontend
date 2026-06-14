import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  conversationInCallPlacementFlow,
  isAffirmativeReply,
  userConfirmingPendingCall,
} from "./callPlacementFlow.js";

describe("isAffirmativeReply", () => {
  it("accepts common yes variants", () => {
    for (const msg of ["Yes", "yes", "Y", "yeah", "sure", "ok", "go ahead"]) {
      assert.equal(isAffirmativeReply(msg), true, msg);
    }
  });

  it("rejects non-confirmations", () => {
    for (const msg of ["No", "hello", "Yan", "9452644540"]) {
      assert.equal(isAffirmativeReply(msg), false, msg);
    }
  });
});

describe("conversationInCallPlacementFlow", () => {
  it("detects an initial call + phone request", () => {
    const messages = [
      {
        role: "user",
        content: "Can you call 9452644540 to return damaged strawberries?",
      },
    ];
    assert.equal(conversationInCallPlacementFlow(messages), true);
  });

  it("detects Node name / confirm prompts", () => {
    const messages = [
      {
        role: "assistant",
        content:
          "Purpose: Return damaged strawberries.\n\nWhat name should I use for the call?",
      },
    ];
    assert.equal(conversationInCallPlacementFlow(messages), true);
  });

  it("returns false for unrelated chat", () => {
    const messages = [
      { role: "user", content: "What's the weather?" },
      { role: "assistant", content: "I can't check weather." },
    ];
    assert.equal(conversationInCallPlacementFlow(messages), false);
  });
});

describe("userConfirmingPendingCall", () => {
  const strawberryFlow = [
    {
      role: "user",
      content: "Can you call 9452644540 to return damaged strawberries?",
    },
    {
      role: "assistant",
      content:
        "Purpose: Return damaged strawberries.\n\nWhat name should I use for the call? Your profile name is Yan.",
    },
    { role: "user", content: "Yan" },
    {
      role: "assistant",
      content:
        "I will call +19452644540 using the name Yan to return damaged strawberries. Should I proceed with the call? (Yes/No)",
    },
  ];

  it("returns true when user says Yes after confirm prompt", () => {
    assert.equal(
      userConfirmingPendingCall([...strawberryFlow, { role: "user", content: "Yes" }], "Yes"),
      true,
    );
  });

  it("returns false for Yes without a pending confirm prompt", () => {
    assert.equal(userConfirmingPendingCall([{ role: "user", content: "Yes" }], "Yes"), false);
  });

  it("returns false when user declines after confirm prompt", () => {
    assert.equal(
      userConfirmingPendingCall(
        [
          ...strawberryFlow,
          {
            role: "assistant",
            content: "Should I proceed with the call? (Yes/No)",
          },
          { role: "user", content: "No" },
        ],
        "No",
      ),
      false,
    );
  });
});
