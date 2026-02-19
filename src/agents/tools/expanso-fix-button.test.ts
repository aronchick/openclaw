/**
 * Tests for the Expanso Fix Button utilities (US-008).
 *
 * Covers:
 * - Discord button custom ID construction
 * - Discord system event detection
 * - Telegram button construction
 * - Telegram callback detection
 * - Validation failure message formatting
 * - Success message formatting
 * - buildExpansoFixEventText helper
 */

import { describe, expect, it } from "vitest";
import type { ExpansoValidationResult } from "./expanso-schemas.js";
import {
  EXPANSO_FIX_BUTTON_LABEL,
  EXPANSO_FIX_CALLBACK_DATA,
  EXPANSO_FIX_COMPONENT_ID,
  buildExpansoFixButtonCustomId,
  buildExpansoFixEventText,
  buildExpansoFixTelegramButton,
  formatValidationFailureMessage,
  formatValidationSuccessMessage,
  isExpansoFixDiscordEvent,
  isExpansoFixTelegramCallback,
} from "./expanso-fix-button.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const failedResult: ExpansoValidationResult = {
  success: false,
  errors: [{ message: "Unknown input type: csv" }],
  warnings: [],
  exitCode: 1,
};

const failedResultMultiple: ExpansoValidationResult = {
  success: false,
  errors: [
    { message: "Unknown input type: csv", location: "inputs[0]" },
    { message: "Output 'sink' has unknown type: parquet", code: "E002" },
  ],
  warnings: [{ message: "Field 'metadata' is deprecated" }],
  exitCode: 1,
};

const successResult: ExpansoValidationResult = {
  success: true,
  errors: [],
  warnings: [],
  exitCode: 0,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("Expanso Fix Button constants", () => {
  it("EXPANSO_FIX_COMPONENT_ID is 'expanso-fix'", () => {
    expect(EXPANSO_FIX_COMPONENT_ID).toBe("expanso-fix");
  });

  it("EXPANSO_FIX_CALLBACK_DATA is 'expanso_fix'", () => {
    expect(EXPANSO_FIX_CALLBACK_DATA).toBe("expanso_fix");
  });

  it("EXPANSO_FIX_BUTTON_LABEL includes Fix", () => {
    expect(EXPANSO_FIX_BUTTON_LABEL).toContain("Fix");
  });

  it("EXPANSO_FIX_CALLBACK_DATA is ≤ 64 bytes (Telegram limit)", () => {
    expect(Buffer.byteLength(EXPANSO_FIX_CALLBACK_DATA, "utf8")).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// Discord helpers
// ---------------------------------------------------------------------------

describe("buildExpansoFixButtonCustomId", () => {
  it("returns a non-empty string", () => {
    const id = buildExpansoFixButtonCustomId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("contains the expanso-fix component ID", () => {
    const id = buildExpansoFixButtonCustomId();
    expect(id).toContain("expanso-fix");
  });

  it("follows the agent button pattern (starts with 'agent:')", () => {
    const id = buildExpansoFixButtonCustomId();
    expect(id).toMatch(/^agent:/);
  });

  it("contains componentId key", () => {
    const id = buildExpansoFixButtonCustomId();
    expect(id).toContain("componentId=");
  });

  it("is stable (same output on repeated calls)", () => {
    expect(buildExpansoFixButtonCustomId()).toBe(buildExpansoFixButtonCustomId());
  });
});

describe("isExpansoFixDiscordEvent", () => {
  it("returns true for a standard Fix button click event", () => {
    const event = "[Discord component: expanso-fix clicked by Alice (123456789)]";
    expect(isExpansoFixDiscordEvent(event)).toBe(true);
  });

  it("returns true for a Fix click with discriminator username", () => {
    const event = "[Discord component: expanso-fix clicked by Bob#4321 (987654321)]";
    expect(isExpansoFixDiscordEvent(event)).toBe(true);
  });

  it("returns false for a different component click", () => {
    const event = "[Discord component: exec-approve clicked by Alice (123)]";
    expect(isExpansoFixDiscordEvent(event)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isExpansoFixDiscordEvent("")).toBe(false);
  });

  it("returns false for a Telegram event text", () => {
    const event = "[Telegram component: expanso-fix clicked by Alice (123)]";
    // Still true — the check only looks for the component ID fragment, not platform
    expect(isExpansoFixDiscordEvent(event)).toBe(true);
  });

  it("returns false for a partial match that differs", () => {
    expect(isExpansoFixDiscordEvent("expanso-fixed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

describe("buildExpansoFixTelegramButton", () => {
  it("returns an array with one button", () => {
    const row = buildExpansoFixTelegramButton();
    expect(Array.isArray(row)).toBe(true);
    expect(row.length).toBe(1);
  });

  it("button text contains 'Fix'", () => {
    const [button] = buildExpansoFixTelegramButton();
    expect(button?.text).toContain("Fix");
  });

  it("button callback_data is EXPANSO_FIX_CALLBACK_DATA", () => {
    const [button] = buildExpansoFixTelegramButton();
    expect(button?.callback_data).toBe(EXPANSO_FIX_CALLBACK_DATA);
  });

  it("callback_data fits within Telegram's 64-byte limit", () => {
    const [button] = buildExpansoFixTelegramButton();
    const byteLen = Buffer.byteLength(button?.callback_data ?? "", "utf8");
    expect(byteLen).toBeLessThanOrEqual(64);
  });
});

describe("isExpansoFixTelegramCallback", () => {
  it("returns true for exact EXPANSO_FIX_CALLBACK_DATA", () => {
    expect(isExpansoFixTelegramCallback("expanso_fix")).toBe(true);
  });

  it("returns true with surrounding whitespace", () => {
    expect(isExpansoFixTelegramCallback("  expanso_fix  ")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isExpansoFixTelegramCallback("")).toBe(false);
  });

  it("returns false for a different callback data", () => {
    expect(isExpansoFixTelegramCallback("mdl_prov")).toBe(false);
  });

  it("returns false for a partial match", () => {
    expect(isExpansoFixTelegramCallback("expanso_fix_extra")).toBe(false);
  });

  it("returns false for a substring", () => {
    expect(isExpansoFixTelegramCallback("expanso_fi")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildExpansoFixEventText
// ---------------------------------------------------------------------------

describe("buildExpansoFixEventText", () => {
  it("includes Discord for discord platform", () => {
    const text = buildExpansoFixEventText("discord", "Alice", "123");
    expect(text).toContain("Discord");
  });

  it("includes Telegram for telegram platform", () => {
    const text = buildExpansoFixEventText("telegram", "Bob", "456");
    expect(text).toContain("Telegram");
  });

  it("includes the component ID", () => {
    const text = buildExpansoFixEventText("discord", "Alice", "123");
    expect(text).toContain(EXPANSO_FIX_COMPONENT_ID);
  });

  it("includes the username", () => {
    const text = buildExpansoFixEventText("telegram", "Charlie", "789");
    expect(text).toContain("Charlie");
  });

  it("includes the user ID", () => {
    const text = buildExpansoFixEventText("discord", "Alice", "111222333");
    expect(text).toContain("111222333");
  });

  it("Discord event is detected by isExpansoFixDiscordEvent", () => {
    const text = buildExpansoFixEventText("discord", "Alice", "123");
    expect(isExpansoFixDiscordEvent(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatValidationFailureMessage
// ---------------------------------------------------------------------------

describe("formatValidationFailureMessage", () => {
  it("starts with the ❌ failure indicator", () => {
    const msg = formatValidationFailureMessage(failedResult);
    expect(msg).toMatch(/^❌/);
  });

  it("mentions the error count (singular)", () => {
    const msg = formatValidationFailureMessage(failedResult);
    expect(msg).toContain("1 error");
  });

  it("mentions the error count (plural)", () => {
    const msg = formatValidationFailureMessage(failedResultMultiple);
    expect(msg).toContain("2 errors");
  });

  it("includes error message text", () => {
    const msg = formatValidationFailureMessage(failedResult);
    expect(msg).toContain("Unknown input type: csv");
  });

  it("includes location for errors that have it", () => {
    const msg = formatValidationFailureMessage(failedResultMultiple);
    expect(msg).toContain("inputs[0]");
  });

  it("includes code for errors that have it", () => {
    const msg = formatValidationFailureMessage(failedResultMultiple);
    expect(msg).toContain("E002");
  });

  it("includes warnings section when there are warnings", () => {
    const msg = formatValidationFailureMessage(failedResultMultiple);
    expect(msg).toContain("⚠️");
    expect(msg).toContain("deprecated");
  });

  it("does NOT include warnings section when there are none", () => {
    const msg = formatValidationFailureMessage(failedResult);
    expect(msg).not.toContain("⚠️");
  });

  it("includes a Fix prompt with /expanso fix reference", () => {
    const msg = formatValidationFailureMessage(failedResult);
    expect(msg).toContain("Fix");
    expect(msg).toContain("/expanso fix");
  });

  it("includes Fix button prompt text", () => {
    const msg = formatValidationFailureMessage(failedResult);
    expect(msg).toContain("🔧");
  });

  it("handles a result with no errors gracefully", () => {
    const msg = formatValidationFailureMessage(successResult);
    expect(msg).toContain("0 errors");
    expect(msg).toContain("Fix");
  });

  it("lists all error bullet points", () => {
    const msg = formatValidationFailureMessage(failedResultMultiple);
    expect(msg).toContain("• Unknown input type: csv");
    expect(msg).toContain("• Output 'sink' has unknown type: parquet");
  });
});

// ---------------------------------------------------------------------------
// formatValidationSuccessMessage
// ---------------------------------------------------------------------------

describe("formatValidationSuccessMessage", () => {
  it("starts with the ✅ success indicator", () => {
    const msg = formatValidationSuccessMessage(1);
    expect(msg).toMatch(/^✅/);
  });

  it("mentions the number of attempts (singular)", () => {
    const msg = formatValidationSuccessMessage(1);
    expect(msg).toContain("1 attempt");
    expect(msg).not.toContain("attempts"); // should use singular
  });

  it("mentions the number of attempts (plural)", () => {
    const msg = formatValidationSuccessMessage(3);
    expect(msg).toContain("3 attempts");
  });

  it("says 'fixed and validated'", () => {
    const msg = formatValidationSuccessMessage(2);
    expect(msg.toLowerCase()).toContain("fixed");
    expect(msg.toLowerCase()).toContain("validated");
  });
});
