import { describe, expect, it } from "vitest";

import {
  SOFT_ERROR_PHRASE_LIMITS,
  getSoftErrorPhraseSettings,
  normalizeSoftErrorPhrases,
} from "@/fork/softErrorPhrase/settings";

describe("soft error phrase settings", () => {
  it("normalizes mixed user input by trimming, dropping blanks, and deduping case-insensitively", () => {
    expect(normalizeSoftErrorPhrases([
      "  Our servers are currently overloaded. Please try again later.  ",
      "",
      "our servers are currently overloaded. please try again later.",
      "An error occurred while processing your request.",
    ])).toEqual([
      "Our servers are currently overloaded. Please try again later.",
      "An error occurred while processing your request.",
    ]);
  });

  it("returns empty list for missing legacy values", () => {
    expect(getSoftErrorPhraseSettings({})).toEqual({
      softErrorPhrases: [],
    });
  });

  it("preserves first trimmed display casing while deduping case-insensitively", () => {
    expect(normalizeSoftErrorPhrases(["Error", " error ", "ERROR"])).toEqual(["Error"]);
  });

  it("rejects configs exceeding max phrase count", () => {
    const tooMany = Array.from({ length: SOFT_ERROR_PHRASE_LIMITS.maxPhrases + 1 }, (_, index) => `Phrase ${index}`);

    expect(() => normalizeSoftErrorPhrases(tooMany)).toThrow(
      `softErrorPhrases cannot contain more than ${SOFT_ERROR_PHRASE_LIMITS.maxPhrases} phrases`
    );
  });

  it("rejects configs exceeding max phrase length", () => {
    const tooLong = "x".repeat(SOFT_ERROR_PHRASE_LIMITS.maxPhraseLength + 1);

    expect(() => normalizeSoftErrorPhrases([tooLong])).toThrow(
      `softErrorPhrases entries must be <= ${SOFT_ERROR_PHRASE_LIMITS.maxPhraseLength} characters`
    );
  });

  it("rejects configs exceeding max total normalized chars", () => {
    const chunk = "a".repeat(SOFT_ERROR_PHRASE_LIMITS.maxPhraseLength);
    const phrases = Array.from(
      { length: Math.floor(SOFT_ERROR_PHRASE_LIMITS.maxTotalChars / SOFT_ERROR_PHRASE_LIMITS.maxPhraseLength) + 1 },
      (_, index) => `${index}`.padStart(2, "0") + chunk.slice(2)
    );

    expect(() => normalizeSoftErrorPhrases(phrases)).toThrow(
      `softErrorPhrases cannot exceed ${SOFT_ERROR_PHRASE_LIMITS.maxTotalChars} total characters`
    );
  });
});
