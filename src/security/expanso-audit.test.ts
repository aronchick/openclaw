/**
 * Tests for the Expanso security audit module.
 *
 * Covers:
 *  - logExpansoExecution: structured JSON output format and all fields
 *  - collectExpansoSandboxFindings: all severity levels and edge cases
 *  - EXPANSO_SANDBOX_ISOLATION_FLAGS: content correctness
 */

import { describe, expect, it } from "vitest";
import {
  EXPANSO_SANDBOX_ISOLATION_FLAGS,
  collectExpansoSandboxFindings,
  logExpansoExecution,
  type ExpansoAuditEntry,
} from "./expanso-audit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ExpansoAuditEntry> = {}): ExpansoAuditEntry {
  return {
    ts: 1_700_000_000_000,
    yamlSize: 512,
    success: true,
    exitCode: 0,
    errorCount: 0,
    warningCount: 0,
    durationMs: 250,
    sandboxed: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EXPANSO_SANDBOX_ISOLATION_FLAGS
// ---------------------------------------------------------------------------

describe("EXPANSO_SANDBOX_ISOLATION_FLAGS", () => {
  it("is a non-empty readonly array", () => {
    expect(Array.isArray(EXPANSO_SANDBOX_ISOLATION_FLAGS)).toBe(true);
    expect(EXPANSO_SANDBOX_ISOLATION_FLAGS.length).toBeGreaterThan(0);
  });

  it("contains --network none", () => {
    expect(EXPANSO_SANDBOX_ISOLATION_FLAGS).toContain("--network none");
  });

  it("contains --read-only", () => {
    expect(EXPANSO_SANDBOX_ISOLATION_FLAGS).toContain("--read-only");
  });

  it("contains --tmpfs /tmp", () => {
    expect(EXPANSO_SANDBOX_ISOLATION_FLAGS).toContain("--tmpfs /tmp");
  });

  it("contains --security-opt no-new-privileges", () => {
    expect(EXPANSO_SANDBOX_ISOLATION_FLAGS).toContain("--security-opt no-new-privileges");
  });

  it("contains --cap-drop ALL", () => {
    expect(EXPANSO_SANDBOX_ISOLATION_FLAGS).toContain("--cap-drop ALL");
  });

  it("contains a --user flag with a non-root UID", () => {
    const userFlag = EXPANSO_SANDBOX_ISOLATION_FLAGS.find((f) => f.startsWith("--user"));
    expect(userFlag).toBeDefined();
    // Should not be root (UID 0)
    expect(userFlag).not.toMatch(/--user 0(:\d+)?/);
  });

  it("is immutable (frozen)", () => {
    expect(() => {
      // TypeScript won't allow push on a readonly, but at runtime we can test Object.isFrozen
      (EXPANSO_SANDBOX_ISOLATION_FLAGS as string[]).push("--test");
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// logExpansoExecution
// ---------------------------------------------------------------------------

describe("logExpansoExecution", () => {
  it("calls the logger with a JSON string", () => {
    const logs: string[] = [];
    logExpansoExecution(makeEntry(), (msg) => logs.push(msg));
    expect(logs).toHaveLength(1);
    // Must be valid JSON
    expect(() => JSON.parse(logs[0])).not.toThrow();
  });

  it("emits event = expanso.binary.execute", () => {
    const logs: string[] = [];
    logExpansoExecution(makeEntry(), (msg) => logs.push(msg));
    const parsed = JSON.parse(logs[0]);
    expect(parsed.event).toBe("expanso.binary.execute");
  });

  it("includes all ExpansoAuditEntry fields in the output", () => {
    const entry = makeEntry({
      ts: 1_700_000_001_000,
      yamlSize: 1024,
      success: false,
      exitCode: 1,
      errorCount: 3,
      warningCount: 1,
      durationMs: 820,
      sandboxed: false,
    });
    const logs: string[] = [];
    logExpansoExecution(entry, (msg) => logs.push(msg));
    const parsed = JSON.parse(logs[0]);

    expect(parsed.ts).toBe(1_700_000_001_000);
    expect(parsed.yamlSize).toBe(1024);
    expect(parsed.success).toBe(false);
    expect(parsed.exitCode).toBe(1);
    expect(parsed.errorCount).toBe(3);
    expect(parsed.warningCount).toBe(1);
    expect(parsed.durationMs).toBe(820);
    expect(parsed.sandboxed).toBe(false);
  });

  it("handles undefined exitCode gracefully (JSON.stringify omits undefined keys)", () => {
    const logs: string[] = [];
    logExpansoExecution(makeEntry({ exitCode: undefined }), (msg) => logs.push(msg));
    // JSON.stringify drops keys with undefined values; the log line must still be valid JSON
    const parsed = JSON.parse(logs[0]);
    expect(parsed.event).toBe("expanso.binary.execute");
    // exitCode key is omitted because JSON.stringify converts undefined to absent
    expect(Object.prototype.hasOwnProperty.call(parsed, "exitCode")).toBe(false);
  });

  it("logs sandboxed=true correctly", () => {
    const logs: string[] = [];
    logExpansoExecution(makeEntry({ sandboxed: true }), (msg) => logs.push(msg));
    expect(JSON.parse(logs[0]).sandboxed).toBe(true);
  });

  it("logs sandboxed=false correctly", () => {
    const logs: string[] = [];
    logExpansoExecution(makeEntry({ sandboxed: false }), (msg) => logs.push(msg));
    expect(JSON.parse(logs[0]).sandboxed).toBe(false);
  });

  it("uses console.error as default logger when none provided", () => {
    // We just verify the function signature works without a logger arg
    // (we can't easily intercept console.error here without mocking)
    expect(() => {
      // Only call if logger arg is required — we're testing that it defaults
      const fn = logExpansoExecution;
      // The function has a default parameter — calling with 1 arg should not throw
      fn(makeEntry());
    }).not.toThrow();
  });

  it("emits a single line per call", () => {
    const logs: string[] = [];
    logExpansoExecution(makeEntry(), (msg) => logs.push(msg));
    logExpansoExecution(makeEntry({ yamlSize: 100 }), (msg) => logs.push(msg));
    expect(logs).toHaveLength(2);
    expect(JSON.parse(logs[1]).yamlSize).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// collectExpansoSandboxFindings — Docker disabled
// ---------------------------------------------------------------------------

describe("collectExpansoSandboxFindings — docker disabled", () => {
  it("returns a warn finding when called with no args", () => {
    const findings = collectExpansoSandboxFindings();
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe("expanso.sandbox.docker_disabled");
    expect(findings[0].severity).toBe("warn");
  });

  it("returns a warn finding when dockerEnabled is false", () => {
    const findings = collectExpansoSandboxFindings({ dockerEnabled: false });
    expect(findings.some((f) => f.checkId === "expanso.sandbox.docker_disabled")).toBe(true);
    const f = findings.find((f) => f.checkId === "expanso.sandbox.docker_disabled")!;
    expect(f.severity).toBe("warn");
  });

  it("docker_disabled finding mentions the binary", () => {
    const findings = collectExpansoSandboxFindings();
    expect(findings[0].detail).toContain("expanso validate");
  });

  it("docker_disabled finding has a remediation", () => {
    const findings = collectExpansoSandboxFindings();
    expect(findings[0].remediation).toBeDefined();
    expect(findings[0].remediation!.length).toBeGreaterThan(0);
  });

  it("does not add further findings when Docker is disabled", () => {
    // Only the docker_disabled finding should be returned
    const findings = collectExpansoSandboxFindings({ dockerEnabled: false });
    expect(findings.every((f) => f.checkId === "expanso.sandbox.docker_disabled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// collectExpansoSandboxFindings — Docker enabled, isolation issues
// ---------------------------------------------------------------------------

describe("collectExpansoSandboxFindings — docker enabled with isolation issues", () => {
  it("returns critical when network is not none", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "bridge",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    const f = findings.find((f) => f.checkId === "expanso.sandbox.network_not_isolated");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("critical");
  });

  it("includes actual network mode in the detail", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "host",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    const f = findings.find((f) => f.checkId === "expanso.sandbox.network_not_isolated");
    expect(f!.detail).toContain("host");
  });

  it("returns critical when networkMode is undefined (unset = default bridge)", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: undefined,
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    const f = findings.find((f) => f.checkId === "expanso.sandbox.network_not_isolated");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("critical");
  });

  it("returns critical when readOnlyRootfs is false", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "none",
      readOnlyRootfs: false,
      capsDropped: true,
      nonRootUser: true,
    });
    const f = findings.find((f) => f.checkId === "expanso.sandbox.no_readonly_rootfs");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("critical");
  });

  it("returns warn when capsDropped is false", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "none",
      readOnlyRootfs: true,
      capsDropped: false,
      nonRootUser: true,
    });
    const f = findings.find((f) => f.checkId === "expanso.sandbox.caps_not_dropped");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warn");
  });

  it("returns warn when nonRootUser is false", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "none",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: false,
    });
    const f = findings.find((f) => f.checkId === "expanso.sandbox.root_user");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warn");
  });

  it("can return multiple findings at once", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "bridge",
      readOnlyRootfs: false,
      capsDropped: false,
      nonRootUser: false,
    });
    const ids = findings.map((f) => f.checkId);
    expect(ids).toContain("expanso.sandbox.network_not_isolated");
    expect(ids).toContain("expanso.sandbox.no_readonly_rootfs");
    expect(ids).toContain("expanso.sandbox.caps_not_dropped");
    expect(ids).toContain("expanso.sandbox.root_user");
  });

  it("does NOT emit the isolated info finding when there are issues", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "bridge",
      readOnlyRootfs: false,
      capsDropped: false,
      nonRootUser: false,
    });
    expect(findings.some((f) => f.checkId === "expanso.sandbox.isolated")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectExpansoSandboxFindings — fully isolated (happy path)
// ---------------------------------------------------------------------------

describe("collectExpansoSandboxFindings — fully isolated", () => {
  it("returns a single info finding when all isolation settings are correct", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "none",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe("expanso.sandbox.isolated");
    expect(findings[0].severity).toBe("info");
  });

  it("mentions --network none and --read-only in the info detail", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "none",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    expect(findings[0].detail).toContain("--network none");
    expect(findings[0].detail).toContain("--read-only");
  });

  it("includes docker image in the info detail when provided", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      dockerImage: "expanso/validate:v1.0.0",
      networkMode: "none",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    expect(findings[0].detail).toContain("expanso/validate:v1.0.0");
  });

  it("does not include docker image prefix when not provided", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "none",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    // The detail should not have " ()" — the empty image case
    expect(findings[0].detail).not.toContain("()");
  });

  it("has no remediation on the info finding", () => {
    const findings = collectExpansoSandboxFindings({
      dockerEnabled: true,
      networkMode: "none",
      readOnlyRootfs: true,
      capsDropped: true,
      nonRootUser: true,
    });
    expect(findings[0].remediation).toBeUndefined();
  });
});
