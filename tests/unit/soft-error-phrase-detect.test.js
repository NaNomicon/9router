import { describe, expect, it } from "vitest";

import { buildSoftErrorPhraseFailure, SOFT_ERROR_PHRASE_ERROR_CODE, SOFT_ERROR_PHRASE_REASON_TAG } from "@/fork/softErrorPhrase/error";
import {
  findSoftErrorPhraseMatch,
  getSoftErrorHoldbackChars,
  getSoftErrorVisibleTextContext,
} from "@/fork/softErrorPhrase/detect";

describe("soft error phrase detection seam", () => {
  it("detects configured soft-error phrases in finalized plain text", () => {
    expect(findSoftErrorPhraseMatch(
      "Error Our servers are currently overloaded. Please try again later.",
      ["Our servers are currently overloaded"]
    )).toEqual({
      matched: true,
      phrase: "Our servers are currently overloaded",
      normalizedPhrase: "our servers are currently overloaded",
    });
  });

  it("returns no match for normal assistant content", () => {
    expect(findSoftErrorPhraseMatch(
      "Here is the refactor you asked for.",
      ["Our servers are currently overloaded"]
    )).toEqual({
      matched: false,
      phrase: null,
      normalizedPhrase: null,
    });
  });

  it("ignores reasoning-only or tool-call-only chat completion shapes", () => {
    expect(getSoftErrorVisibleTextContext({
      choices: [{
        message: {
          reasoning_content: "Our servers are currently overloaded",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
        },
      }],
    })).toEqual({
      eligible: false,
      text: "",
      reason: "chat_completion_without_visible_text",
    });
  });

  it("extracts visible text from chat completion responses", () => {
    expect(getSoftErrorVisibleTextContext({
      choices: [{
        message: { role: "assistant", content: "An error occurred while processing your request." },
      }],
    })).toEqual({
      eligible: true,
      text: "An error occurred while processing your request.",
      reason: "chat_completion_message",
    });
  });

  it("extracts visible text from Responses-style outputs using the last non-empty message", () => {
    expect(getSoftErrorVisibleTextContext({
      output: [
        { type: "message", content: [{ type: "output_text", text: "" }] },
        { type: "function_call", name: "lookup", arguments: "{}" },
        { type: "message", content: [{ type: "output_text", text: "Our servers are currently overloaded." }] },
      ],
    })).toEqual({
      eligible: true,
      text: "Our servers are currently overloaded.",
      reason: "responses_output_text",
    });
  });

  it("excludes tool-call-only or structured-output-first results with no visible assistant text", () => {
    expect(getSoftErrorVisibleTextContext({
      output: [
        { type: "function_call", name: "lookup", arguments: "{}" },
      ],
    })).toEqual({
      eligible: false,
      text: "",
      reason: "no_message_output",
    });
  });

  it("computes holdback window with the 256-char floor", () => {
    expect(getSoftErrorHoldbackChars(["overloaded"])).toBe(256);
  });

  it("computes holdback window as 2x the max normalized phrase length when larger than the floor", () => {
    const longPhrase = "a".repeat(180);
    expect(getSoftErrorHoldbackChars([longPhrase])).toBe(360);
  });

  it("builds a distinct internal failure marker", () => {
    expect(buildSoftErrorPhraseFailure(
      { phrase: "Our servers are currently overloaded" },
      { provider: "codex" }
    )).toEqual({
      reasonTag: SOFT_ERROR_PHRASE_REASON_TAG,
      errorCode: SOFT_ERROR_PHRASE_ERROR_CODE,
      matchedPhrase: "Our servers are currently overloaded",
      message: `[${SOFT_ERROR_PHRASE_ERROR_CODE}] codex response matched configured soft-error phrase: Our servers are currently overloaded`,
    });
  });
});
