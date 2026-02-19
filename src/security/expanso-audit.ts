/**
 * Expanso Security Audit Module
 *
 * Provides:
 *  - Structured audit logging for Expanso binary executions
 *  - Security findings for sandbox isolation verification
 *
 * This module ensures that every call to the `expanso validate` binary is
 * auditable and that Docker sandbox isolation settings meet OpenClaw's
 * security requirements (network isolation + read-only root filesystem).
 *
 * @example
 * // Log a binary execution
 * logExpansoExecution({
 *   ts: Date.now(),
 *   yamlSize: yaml.length,
 *   success: true,
 *   exitCode: 0,
 *   errorCount: 0,
 *   warningCount: 2,
 *   durationMs: 350,
 *   sandboxed: true,
 * });
 *
 * @example
 * // Check sandbox isolation in a security audit
 * const findings = collectExpansoSandboxFindings({ networkMode: "none", readOnlyRootfs: true });
 */

import type { SecurityAuditFinding } from "./audit-extra.js";

// ---------------------------------------------------------------------------
// Audit log types
// ---------------------------------------------------------------------------

/**
 * Structured record of a single Expanso binary execution event.
 *
 * Written to stderr as JSON via {@link logExpansoExecution}.
 * Every field is included so that log aggregators can filter/alert on any
 * dimension without parsing free-form text.
 */
export type ExpansoAuditEntry = {
  /** Unix epoch milliseconds at the start of the execution. */
  ts: number;
  /** Byte length of the YAML input that was validated. */
  yamlSize: number;
  /** Whether the binary exited with code 0 (pipeline is valid). */
  success: boolean;
  /** Exit code returned by the binary (undefined if the process could not be spawned). */
  exitCode: number | undefined;
  /** Number of validation errors in the result. */
  errorCount: number;
  /** Number of validation warnings in the result. */
  warningCount: number;
  /** Wall-clock milliseconds from invocation to result. */
  durationMs: number;
  /**
   * Whether the binary was run inside a Docker isolation sandbox.
   * When false the binary ran directly on the host — this should be flagged
   * in production deployments.
   */
  sandboxed: boolean;
};

// ---------------------------------------------------------------------------
// Sandbox isolation constants
// ---------------------------------------------------------------------------

/**
 * Recommended Docker run flags that achieve host network/filesystem isolation.
 *
 * These flags are the reference implementation for the cloud validation sandbox:
 *
 * - `--network none`        — no outbound network access from the container
 * - `--read-only`           — root filesystem is read-only (no writes to container FS)
 * - `--tmpfs /tmp`          — provides a writable temp directory for the pipeline YAML
 * - `--security-opt no-new-privileges` — prevents privilege escalation inside the container
 * - `--cap-drop ALL`        — drops all Linux capabilities
 * - `--user 65534:65534`    — runs as nobody:nogroup (non-root)
 *
 * @example
 * // Build a docker run command
 * const cmd = `docker run ${EXPANSO_SANDBOX_ISOLATION_FLAGS.join(' ')} expanso/validate:latest`;
 */
export const EXPANSO_SANDBOX_ISOLATION_FLAGS: readonly string[] = Object.freeze([
  "--network none",
  "--read-only",
  "--tmpfs /tmp",
  "--security-opt no-new-privileges",
  "--cap-drop ALL",
  "--user 65534:65534",
]);

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Write a structured Expanso binary execution audit entry to stderr.
 *
 * The entry is serialised as a single-line JSON object prefixed with the
 * `event` discriminator `"expanso.binary.execute"`.  Log aggregation systems
 * (Datadog, CloudWatch, etc.) can parse this line and index every field.
 *
 * @param entry - The execution event to log.
 * @param logger - Optional override for the output function (defaults to `console.error`).
 *                 Inject a custom logger in tests to capture output without polluting
 *                 stderr.
 *
 * @example
 * const logs: string[] = [];
 * logExpansoExecution(entry, (msg) => logs.push(msg));
 * expect(JSON.parse(logs[0])).toMatchObject({ event: "expanso.binary.execute" });
 */
export function logExpansoExecution(
  entry: ExpansoAuditEntry,
  logger: (message: string) => void = (msg) => console.error(msg),
): void {
  const record = {
    event: "expanso.binary.execute",
    ...entry,
  };
  logger(JSON.stringify(record));
}

// ---------------------------------------------------------------------------
// Sandbox isolation findings
// ---------------------------------------------------------------------------

/**
 * Options for {@link collectExpansoSandboxFindings}.
 *
 * Describe the current runtime configuration of the Expanso validation sandbox.
 * When called with no options (or all `undefined`) the function assumes the sandbox
 * is **not** configured and returns appropriate warnings.
 */
export type ExpansoSandboxOptions = {
  /**
   * Whether the Docker sandbox is enabled.
   * Set to `true` only when the validator is actually running inside Docker.
   * Defaults to `false`.
   */
  dockerEnabled?: boolean;
  /**
   * Docker image used for the sandbox (informational, included in findings).
   * Example: `"expanso/validate:latest"`.
   */
  dockerImage?: string;
  /**
   * Docker `--network` value.
   * MUST be `"none"` to pass the isolation check.
   * Any other value (including `"bridge"` or `"host"`) triggers a critical finding.
   */
  networkMode?: string;
  /**
   * Whether Docker `--read-only` is set for the container root filesystem.
   * When false a compromised binary could write files to the container root.
   */
  readOnlyRootfs?: boolean;
  /**
   * Whether `--cap-drop ALL` is set on the Docker container.
   * Dropping all capabilities prevents privilege-escalation techniques.
   */
  capsDropped?: boolean;
  /**
   * Whether the container runs as a non-root user (UID > 0).
   * Running as root inside the container is a significant risk even with
   * other mitigations in place.
   */
  nonRootUser?: boolean;
};

/**
 * Collect security findings about the Expanso Docker sandbox configuration.
 *
 * Run these checks as part of the OpenClaw security audit to verify that the
 * cloud validation sandbox meets isolation requirements before Expanso pipelines
 * are validated in production.
 *
 * Severity mapping:
 * - `warn`     — Docker sandbox not configured (direct binary execution)
 * - `critical` — Sandbox configured but network/FS isolation disabled
 * - `info`     — All isolation checks pass
 *
 * @param opts - Current sandbox configuration (defaults to "not configured").
 * @returns Array of {@link SecurityAuditFinding} objects, empty when fully secure.
 */
export function collectExpansoSandboxFindings(
  opts?: ExpansoSandboxOptions,
): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];

  if (!opts?.dockerEnabled) {
    // Docker sandbox is not enabled — binary runs directly on the host.
    findings.push({
      checkId: "expanso.sandbox.docker_disabled",
      severity: "warn",
      title: "Expanso validation sandbox is not using Docker isolation",
      detail:
        "The Expanso pipeline validator is executing the `expanso validate` binary directly " +
        "on the host, without Docker isolation. Malformed or adversarial pipeline YAML could " +
        "interact with host resources if the binary has vulnerabilities.",
      remediation:
        `Enable Docker isolation by wrapping the binary in a container with: ` +
        EXPANSO_SANDBOX_ISOLATION_FLAGS.join(" ") +
        ". See EXPANSO_SANDBOX_ISOLATION_FLAGS for the full recommended flag set.",
    });
    // Cannot check further isolation properties without Docker
    return findings;
  }

  // Docker is enabled — check individual isolation properties.
  if (opts.networkMode !== "none") {
    const actual = opts.networkMode ?? "bridge (default)";
    findings.push({
      checkId: "expanso.sandbox.network_not_isolated",
      severity: "critical",
      title: "Expanso sandbox container has network access",
      detail:
        `Docker network mode is "${actual}"; the validation sandbox can reach the host network. ` +
        "A compromised binary or adversarial pipeline YAML could exfiltrate data or initiate " +
        "outbound connections.",
      remediation: "Set Docker --network=none on the validation container.",
    });
  }

  if (!opts.readOnlyRootfs) {
    findings.push({
      checkId: "expanso.sandbox.no_readonly_rootfs",
      severity: "critical",
      title: "Expanso sandbox container root filesystem is writable",
      detail:
        "Docker --read-only is not set; the validation container's root filesystem is writable. " +
        "A compromised binary could modify container files or stage a persistence mechanism.",
      remediation: "Add --read-only and --tmpfs /tmp to the docker run command.",
    });
  }

  if (!opts.capsDropped) {
    findings.push({
      checkId: "expanso.sandbox.caps_not_dropped",
      severity: "warn",
      title: "Expanso sandbox container retains Linux capabilities",
      detail:
        "Docker --cap-drop ALL is not set; the validation container retains default Linux " +
        "capabilities, which increases the risk of privilege escalation.",
      remediation: "Add --cap-drop ALL to the docker run command.",
    });
  }

  if (!opts.nonRootUser) {
    findings.push({
      checkId: "expanso.sandbox.root_user",
      severity: "warn",
      title: "Expanso sandbox container runs as root",
      detail:
        "The validation container is running as root (UID 0). Even with other mitigations, " +
        "running as root inside the container increases blast radius if the binary is exploited.",
      remediation: "Add --user 65534:65534 (nobody:nogroup) to the docker run command.",
    });
  }

  // All checks passed if no critical/warn findings were added above.
  const hasIssues = findings.length > 0;
  if (!hasIssues) {
    const image = opts.dockerImage ? ` (${opts.dockerImage})` : "";
    findings.push({
      checkId: "expanso.sandbox.isolated",
      severity: "info",
      title: "Expanso sandbox is correctly isolated",
      detail:
        `Expanso validation sandbox${image} is running with --network none, --read-only, ` +
        "--cap-drop ALL, and a non-root user. Host network and filesystem are protected.",
    });
  }

  return findings;
}
