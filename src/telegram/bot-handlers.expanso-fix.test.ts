/**
 * Tests for the Expanso Fix Button callback handling in the Telegram bot.
 *
 * Verifies that:
 * 1. When `callback_data === "expanso_fix"` is received, `enqueueSystemEvent`
 *    is called with an event text that mentions the Expanso fix component ID.
 * 2. The handler returns early (does NOT call processMessage for fix callbacks).
 * 3. Non-fix callbacks fall through to processMessage.
 * 4. The system event text contains the expected component ID and platform.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPANSO_FIX_CALLBACK_DATA,
  EXPANSO_FIX_COMPONENT_ID,
} from "../agents/tools/expanso-fix-button.js";

// ---------------------------------------------------------------------------
// Hoisted mocks (must be declared before any imports that use them)
// ---------------------------------------------------------------------------

const enqueueSystemEventMock = vi.hoisted(() => vi.fn());
const readChannelAllowFromStoreMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const resolveAgentRouteMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ sessionKey: "telegram:main:dm:123", agentId: "main" }),
);
const listSkillCommandsMock = vi.hoisted(() => vi.fn().mockReturnValue([]));
const loadConfigMock = vi.hoisted(() => vi.fn().mockReturnValue({}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: enqueueSystemEventMock,
  drainSystemEvents: vi.fn().mockReturnValue([]),
}));

vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: readChannelAllowFromStoreMock,
  upsertChannelPairingRequest: vi.fn().mockResolvedValue({ code: "CODE", created: true }),
  writeChannelAllowFromStore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routing/resolve-route.js", () => ({
  resolveAgentRoute: resolveAgentRouteMock,
}));

vi.mock("../auto-reply/skill-commands.js", () => ({
  listSkillCommandsForAgents: listSkillCommandsMock,
}));

vi.mock("../channels/plugins/config-writes.js", () => ({
  resolveChannelConfigWrites: vi.fn().mockReturnValue(false),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: loadConfigMock,
  };
});

vi.mock("../config/io.js", () => ({
  writeConfigFile: vi.fn(),
  readConfigFile: vi.fn().mockReturnValue({}),
}));

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    loadSessionStore: vi.fn().mockReturnValue({}),
    resolveStorePath: vi.fn().mockReturnValue("/tmp/sessions"),
  };
});

vi.mock("../auto-reply/reply/commands-models.js", () => ({
  buildModelsProviderData: vi.fn().mockResolvedValue({ byProvider: new Map(), providers: [] }),
}));

vi.mock("../auto-reply/reply/model-selection.js", () => ({
  resolveStoredModelOverride: vi.fn().mockReturnValue(null),
}));

vi.mock("../group-migration.js", () => ({
  migrateTelegramGroupConfig: vi.fn(),
}));

vi.mock("../auto-reply/reply/commands-info.js", () => ({
  buildCommandsPaginationKeyboard: vi.fn().mockReturnValue([]),
}));

vi.mock("../auto-reply/status.js", () => ({
  buildCommandsMessagePaginated: vi
    .fn()
    .mockReturnValue({ text: "", currentPage: 1, totalPages: 1 }),
}));

vi.mock("../routing/session-key.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routing/session-key.js")>();
  return {
    ...actual,
    resolveThreadSessionKeys: vi.fn().mockReturnValue(null),
  };
});

vi.mock("../agents/agent-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/agent-scope.js")>();
  return {
    ...actual,
    resolveDefaultAgentId: vi.fn().mockReturnValue(null),
  };
});

import type { RegisterTelegramHandlerParams } from "./bot-native-commands.js";
import { registerTelegramHandlers } from "./bot-handlers.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build minimal params for registerTelegramHandlers, capturing the
 * `bot.on("callback_query", handler)` registration.
 */
function buildParams() {
  const processMessageMock = vi.fn().mockResolvedValue(undefined);
  const handlers: Record<string, (ctx: unknown) => Promise<void>> = {};

  const bot = {
    api: {
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      setMyCommands: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    },
    on: vi.fn().mockImplementation((event: string, handler: (ctx: unknown) => Promise<void>) => {
      handlers[event] = handler;
    }),
    command: vi.fn(),
  };

  const params: RegisterTelegramHandlerParams = {
    bot: bot as unknown as RegisterTelegramHandlerParams["bot"],
    cfg: {},
    runtime: {
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as RegisterTelegramHandlerParams["runtime"],
    accountId: "default",
    telegramCfg: {
      allowFrom: ["999"],
      dmPolicy: "open",
    } as unknown as RegisterTelegramHandlerParams["telegramCfg"],
    allowFrom: [],
    groupAllowFrom: [],
    replyToMode: "off",
    textLimit: 4096,
    useAccessGroups: false,
    nativeEnabled: false,
    nativeSkillsEnabled: false,
    nativeDisabledExplicit: false,
    resolveGroupPolicy: () => ({ allowlistEnabled: false, allowed: true }),
    resolveTelegramGroupConfig: () => ({
      groupConfig: undefined,
      topicConfig: undefined,
    }),
    shouldSkipUpdate: () => false,
    opts: { token: "test" },
    processMessage: processMessageMock,
  } as unknown as RegisterTelegramHandlerParams;

  return { bot, params, handlers, processMessageMock };
}

/**
 * Build a minimal Telegram callback query context.
 */
function buildCallbackCtx(callbackData: string, fromId = 999, chatId = 123) {
  return {
    callbackQuery: {
      id: "cq-id-123",
      from: { id: fromId, username: "testuser" },
      message: {
        message_id: 42,
        chat: { id: chatId, type: "private" },
      },
      data: callbackData,
    },
    me: { username: "MyBot" },
    getFile: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  enqueueSystemEventMock.mockReset();
  resolveAgentRouteMock.mockReturnValue({ sessionKey: "telegram:main:dm:123", agentId: "main" });
  readChannelAllowFromStoreMock.mockResolvedValue([]);
  loadConfigMock.mockReturnValue({});
});

describe("Telegram bot-handlers: Expanso Fix callback integration", () => {
  it("registers a callback_query event handler", () => {
    const { bot, params } = buildParams();
    registerTelegramHandlers(params);

    const onMock = bot.on as ReturnType<typeof vi.fn>;
    const hasCallbackQuery = onMock.mock.calls.some(
      (call: unknown[]) => call[0] === "callback_query",
    );
    expect(hasCallbackQuery).toBe(true);
  });

  it("calls enqueueSystemEvent when expanso_fix callback is received", async () => {
    const { params, handlers } = buildParams();
    registerTelegramHandlers(params);

    const handler = handlers["callback_query"];
    expect(handler).toBeTruthy();

    await handler!(buildCallbackCtx(EXPANSO_FIX_CALLBACK_DATA));

    expect(enqueueSystemEventMock).toHaveBeenCalledTimes(1);
  });

  it("system event text references the expanso-fix component ID", async () => {
    const { params, handlers } = buildParams();
    registerTelegramHandlers(params);

    await handlers["callback_query"]!(buildCallbackCtx(EXPANSO_FIX_CALLBACK_DATA));

    const [eventText] = enqueueSystemEventMock.mock.calls[0] as [string, unknown];
    expect(eventText).toContain(EXPANSO_FIX_COMPONENT_ID);
  });

  it("system event text mentions Telegram", async () => {
    const { params, handlers } = buildParams();
    registerTelegramHandlers(params);

    await handlers["callback_query"]!(buildCallbackCtx(EXPANSO_FIX_CALLBACK_DATA));

    const [eventText] = enqueueSystemEventMock.mock.calls[0] as [string, unknown];
    expect(eventText).toContain("Telegram");
  });

  it("system event text includes the user info", async () => {
    const { params, handlers } = buildParams();
    registerTelegramHandlers(params);

    await handlers["callback_query"]!(buildCallbackCtx(EXPANSO_FIX_CALLBACK_DATA, 999));

    const [eventText] = enqueueSystemEventMock.mock.calls[0] as [string, unknown];
    // Either username or user ID should be in the event text
    expect(eventText).toMatch(/testuser|999/);
  });

  it("does NOT call enqueueSystemEvent for non-fix callbacks (mdl_prov)", async () => {
    const { params, handlers } = buildParams();
    registerTelegramHandlers(params);

    await handlers["callback_query"]!(buildCallbackCtx("mdl_prov"));

    expect(enqueueSystemEventMock).not.toHaveBeenCalled();
  });

  it("does NOT call processMessage when expanso_fix callback is received", async () => {
    const { params, handlers, processMessageMock } = buildParams();
    registerTelegramHandlers(params);

    await handlers["callback_query"]!(buildCallbackCtx(EXPANSO_FIX_CALLBACK_DATA));

    expect(processMessageMock).not.toHaveBeenCalled();
  });

  it("calls processMessage for unrelated callback data (fallthrough)", async () => {
    const { params, handlers, processMessageMock } = buildParams();
    registerTelegramHandlers(params);

    await handlers["callback_query"]!(buildCallbackCtx("some_other_action"));

    expect(processMessageMock).toHaveBeenCalledTimes(1);
    expect(enqueueSystemEventMock).not.toHaveBeenCalled();
  });

  it("passes sessionKey to enqueueSystemEvent", async () => {
    resolveAgentRouteMock.mockReturnValue({
      sessionKey: "telegram:main:dm:custom",
      agentId: "main",
    });
    const { params, handlers } = buildParams();
    registerTelegramHandlers(params);

    await handlers["callback_query"]!(buildCallbackCtx(EXPANSO_FIX_CALLBACK_DATA));

    const [, opts] = enqueueSystemEventMock.mock.calls[0] as [string, { sessionKey: string }];
    expect(opts.sessionKey).toBe("telegram:main:dm:custom");
  });
});
