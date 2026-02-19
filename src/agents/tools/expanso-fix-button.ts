/**
 * Expanso Fix Button Utilities
 *
 * Provides helpers to format validation failure messages with an interactive
 * "Fix" button for both Discord and Telegram. When a user clicks "Fix",
 * a system event is enqueued so the agent can trigger a follow-up `fix` run.
 *
 * ## Discord
 * Uses the existing `buildAgentButtonCustomId` mechanism. The agent button
 * fires: `[Discord component: expanso-fix clicked by <username> (<userId>)]`
 * The Expanso Expert agent sees this event and re-runs the `expanso` tool
 * with `action: "fix"`, using the YAML from conversation context.
 *
 * ## Telegram
 * Uses an inline keyboard button with `callback_data: "expanso_fix"`.
 * The Telegram callback handler detects this pattern and enqueues the same
 * style of system event, keeping Discord and Telegram behaviour consistent.
 *
 * @example
 * // Format a validation failure with a Fix button (agent-side)
 * const msg = formatValidationFailureMessage(validationResult);
 * // msg includes "🔧 Use `/expanso fix` or click the Fix button …"
 *
 * // In Discord monitor: button is rendered via buildAgentButtonCustomId
 * // In Telegram: button is rendered via buildExpansoFixTelegramButton()
 */

import type { ButtonRow } from "../../telegram/model-buttons.js";
import type { ExpansoValidationResult } from "./expanso-schemas.js";
import { buildAgentButtonCustomId } from "../../discord/monitor/agent-components.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Component ID used to identify the Expanso Fix button on Discord.
 * Embedded in the button's custom ID via `buildAgentButtonCustomId`.
 */
export const EXPANSO_FIX_COMPONENT_ID = "expanso-fix";

/**
 * Callback data string for the Expanso Fix button on Telegram.
 * Must be ≤ 64 bytes (Telegram limit).
 */
export const EXPANSO_FIX_CALLBACK_DATA = "expanso_fix";

/**
 * Human-readable label shown on the Fix button in both platforms.
 */
export const EXPANSO_FIX_BUTTON_LABEL = "🔧 Fix";

// ---------------------------------------------------------------------------
// Discord helpers
// ---------------------------------------------------------------------------

/**
 * Build the Discord custom ID for the Expanso Fix button.
 *
 * The returned string follows the `agent:componentId=<id>` pattern recognised
 * by {@link AgentComponentButton}. When clicked, the Discord gateway fires:
 * `[Discord component: expanso-fix clicked by <username> (<userId>)]`
 */
export function buildExpansoFixButtonCustomId(): string {
  return buildAgentButtonCustomId(EXPANSO_FIX_COMPONENT_ID);
}

/**
 * Returns `true` when a Discord system-event text was produced by the
 * Expanso Fix button being clicked.
 *
 * @example
 * isExpansoFixDiscordEvent(
 *   "[Discord component: expanso-fix clicked by Alice (123)]"
 * ); // true
 */
export function isExpansoFixDiscordEvent(eventText: string): boolean {
  return eventText.includes(`component: ${EXPANSO_FIX_COMPONENT_ID} clicked`);
}

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

/**
 * Build a single Telegram inline keyboard row with the Fix button.
 *
 * @example
 * buildExpansoFixTelegramButton()
 * // → [{ text: "🔧 Fix", callback_data: "expanso_fix" }]
 */
export function buildExpansoFixTelegramButton(): ButtonRow {
  return [{ text: EXPANSO_FIX_BUTTON_LABEL, callback_data: EXPANSO_FIX_CALLBACK_DATA }];
}

/**
 * Returns `true` when the Telegram callback data corresponds to the
 * Expanso Fix button.
 */
export function isExpansoFixTelegramCallback(data: string): boolean {
  return data.trim() === EXPANSO_FIX_CALLBACK_DATA;
}

// ---------------------------------------------------------------------------
// System event helpers
// ---------------------------------------------------------------------------

/**
 * Build the system event text injected into the agent session when the Fix
 * button is clicked. The agent sees this text and knows to call the
 * `expanso` tool with `action: "fix"`.
 *
 * @param platform - "discord" or "telegram"
 * @param username - Display name of the user who clicked the button
 * @param userId   - Platform user ID (string)
 */
export function buildExpansoFixEventText(
  platform: "discord" | "telegram",
  username: string,
  userId: string,
): string {
  return `[${platform === "discord" ? "Discord" : "Telegram"} component: ${EXPANSO_FIX_COMPONENT_ID} clicked by ${username} (${userId})]`;
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Format a human-readable validation failure message that includes a prompt
 * to use the Fix button.
 *
 * The returned string is intended to be sent as the agent's text reply.
 * The "Fix" button itself must be attached separately as a Discord component
 * or Telegram inline keyboard row.
 *
 * @param result - The validation result (should have `success: false`).
 * @returns Formatted string with error summary and fix instructions.
 *
 * @example
 * formatValidationFailureMessage({
 *   success: false,
 *   errors: [{ message: "Unknown input type: csv" }],
 *   warnings: [],
 * });
 * // "❌ Pipeline validation failed with 1 error:\n• Unknown input type: csv\n\n🔧 Click **Fix** …"
 */
export function formatValidationFailureMessage(result: ExpansoValidationResult): string {
  const errorCount = result.errors.length;
  const warningCount = result.warnings.length;

  const lines: string[] = [];

  // Header
  const errLabel = errorCount === 1 ? "error" : "errors";
  lines.push(`❌ Pipeline validation failed with ${errorCount} ${errLabel}:`);

  // Errors
  for (const err of result.errors) {
    const loc = err.location ? ` (at ${err.location})` : "";
    const code = err.code ? ` [${err.code}]` : "";
    lines.push(`• ${err.message}${loc}${code}`);
  }

  // Warnings (if any)
  if (warningCount > 0) {
    lines.push("");
    const warnLabel = warningCount === 1 ? "warning" : "warnings";
    lines.push(`⚠️ ${warningCount} ${warnLabel}:`);
    for (const warn of result.warnings) {
      const loc = warn.location ? ` (at ${warn.location})` : "";
      lines.push(`• ${warn.message}${loc}`);
    }
  }

  // Fix prompt
  lines.push("");
  lines.push(
    `🔧 Click **Fix** to automatically repair this pipeline, or run \`/expanso fix\` with a description.`,
  );

  return lines.join("\n");
}

/**
 * Format a short validation success message for a fixed pipeline.
 *
 * @param attempts - Number of fix attempts taken.
 */
export function formatValidationSuccessMessage(attempts: number): string {
  const attemptText = attempts === 1 ? "1 attempt" : `${attempts} attempts`;
  return `✅ Pipeline fixed and validated successfully in ${attemptText}!`;
}
