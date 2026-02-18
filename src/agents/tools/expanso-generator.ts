/**
 * NL-to-Pipeline Generator tool for Expanso pipelines.
 *
 * Converts natural language descriptions into valid Expanso YAML pipeline
 * configurations. Uses an LLM to map plain English to `ExpansoPipelineSchema`
 * structures, then serialises the result to YAML.
 *
 * @example
 * // Create the tool with a real LLM backend
 * const tool = createExpansoGeneratorTool({ apiKey: process.env.ANTHROPIC_API_KEY });
 *
 * // Create the tool with a mock generator (for tests)
 * const tool = createExpansoGeneratorTool({ generatePipeline: myMockFn });
 */

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { stringify as yamlStringify } from "yaml";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import { ExpansoPipelineSchema, type ExpansoPipeline } from "./expanso-schemas.js";

// ---------------------------------------------------------------------------
// Input schema for the generator tool
// ---------------------------------------------------------------------------

/**
 * TypeBox schema for the parameters accepted by the `expanso_generate` tool.
 *
 * The LLM agent passes:
 *  - `description` – a plain English description of the desired pipeline
 *  - `apiKey`      – (optional) API key forwarded to the internal LLM call
 */
const ExpansoGeneratorInputSchema = Type.Object({
  description: Type.String({
    description:
      "Natural language description of the data pipeline to generate. " +
      "For example: 'Read CSV files from disk, filter rows where status is active, write as JSON to stdout'.",
  }),
  apiKey: Type.Optional(
    Type.String({
      description: "API key for the LLM used internally to generate the pipeline (optional).",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Options passed to {@link createExpansoGeneratorTool}.
 */
export type ExpansoGeneratorToolOptions = {
  /**
   * Default API key forwarded to the internal LLM call.
   * Can be overridden per-call via the `apiKey` tool parameter.
   */
  apiKey?: string;
  /**
   * Override the internal LLM-based pipeline generation function.
   *
   * Inject a mock here during testing to avoid real LLM calls.
   * Defaults to {@link defaultGeneratePipeline}.
   */
  generatePipeline?: (description: string, apiKey?: string) => Promise<ExpansoPipeline>;
};

/**
 * The structured result returned by the `expanso_generate` tool.
 */
export type ExpansoGeneratorResult = {
  /** The generated pipeline as a validated JS object matching `ExpansoPipeline`. */
  pipeline: ExpansoPipeline;
  /** The pipeline serialised as a YAML string ready for `expanso validate`. */
  yaml: string;
};

// ---------------------------------------------------------------------------
// Default LLM-backed generator
// ---------------------------------------------------------------------------

/**
 * System prompt given to the LLM when generating a pipeline.
 *
 * Instructs the model to produce a JSON object matching `ExpansoPipelineSchema`.
 * The response is parsed and validated before being returned.
 */
const GENERATOR_SYSTEM_PROMPT = `\
You are an expert at building Expanso data pipeline configurations.
Given a natural language description, generate a JSON object that represents
an Expanso pipeline. The JSON must match this structure exactly:

{
  "name":        "<kebab-case pipeline name>",
  "description": "<optional human-readable description>",
  "inputs": [
    { "name": "<unique-name>", "type": "<driver>", "config": { "<key>": "<value>" } }
  ],
  "transforms": [
    {
      "name":      "<unique-name>",
      "type":      "<processor>",
      "config":    { "<key>": "<value>" },
      "dependsOn": ["<other-transform-name>"]
    }
  ],
  "outputs": [
    { "name": "<unique-name>", "type": "<driver>", "config": { "<key>": "<value>" } }
  ]
}

Rules:
- "inputs" and "outputs" are required and must have at least one item each.
- "transforms" and "description" are optional.
- "config" objects are optional on every component; omit them if empty.
- "dependsOn" is optional on transforms; omit it if empty.
- Pipeline "name" must be kebab-case (e.g. "csv-to-json-pipeline").

Common input types:  file, stdin, http, kafka, mqtt, redis, s3, generate
Common transform types: bloblang, filter, mapping, split, archive, decompress, dedupe
Common output types: file, stdout, http, kafka, mqtt, redis, s3, drop

Respond ONLY with a single valid JSON object. Do not wrap it in markdown code fences.`;

/**
 * Uses the pi-ai `completeSimple` function to ask the LLM to produce a
 * JSON pipeline from the given description.
 *
 * Validates the raw LLM output against `ExpansoPipelineSchema` before returning.
 *
 * @throws {Error} if the LLM response cannot be parsed as JSON or fails schema validation.
 */
export async function defaultGeneratePipeline(
  description: string,
  apiKey?: string,
): Promise<ExpansoPipeline> {
  // Dynamic import keeps tests fast – test files inject their own generator.
  const { completeSimple } = await import("@mariozechner/pi-ai");

  // Minimal model descriptor for the Anthropic Claude API.
  // We avoid pulling in the full MODELS registry to keep this module lightweight.
  const model = {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    api: "anthropic-messages" as const,
    provider: "anthropic" as const,
    baseUrl: "https://api.anthropic.com",
    reasoning: false,
    input: ["text" as const],
    contextWindow: 200_000,
    maxTokens: 8_096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  const message = await completeSimple(
    model,
    {
      messages: [
        {
          role: "user",
          content: GENERATOR_SYSTEM_PROMPT + `\n\nGenerate an Expanso pipeline for: ${description}`,
          timestamp: Date.now(),
        },
      ],
    },
    { apiKey, maxTokens: 2_048 },
  );

  const text = message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    throw new Error(`LLM response could not be parsed as JSON. Response: ${text.slice(0, 500)}`, {
      cause: _err,
    });
  }

  if (!Value.Check(ExpansoPipelineSchema, parsed)) {
    const errors = [...Value.Errors(ExpansoPipelineSchema, parsed)].map(
      (e) => `${e.path}: ${e.message}`,
    );
    throw new Error(
      `LLM generated a pipeline that failed schema validation:\n${errors.join("\n")}`,
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Creates an Expanso NL-to-Pipeline generator tool.
 *
 * When registered on an agent, the agent can call this tool with a natural
 * language description and receive a validated Expanso pipeline YAML string
 * ready for use with the `expanso validate` binary.
 *
 * @param opts - Optional configuration (API key, generator override for tests).
 * @returns An `AnyAgentTool` compatible with `@mariozechner/pi-agent-core`.
 *
 * @example
 * // Production usage
 * const tool = createExpansoGeneratorTool({ apiKey: 'sk-...' });
 *
 * // Test usage — inject a deterministic mock
 * const tool = createExpansoGeneratorTool({
 *   generatePipeline: async () => ({
 *     name: 'test-pipeline',
 *     inputs:  [{ name: 'in',  type: 'stdin'  }],
 *     outputs: [{ name: 'out', type: 'stdout' }],
 *   }),
 * });
 */
export function createExpansoGeneratorTool(opts?: ExpansoGeneratorToolOptions): AnyAgentTool {
  const generatePipeline = opts?.generatePipeline ?? defaultGeneratePipeline;
  const defaultApiKey = opts?.apiKey;

  return {
    label: "Expanso Pipeline Generator",
    name: "expanso_generate",
    description:
      "Generate a valid Expanso pipeline YAML configuration from a natural language description. " +
      "Example: 'Read CSV files from /data/input, convert each row to JSON, write to stdout.' " +
      "Returns both the structured pipeline object and the YAML string.",
    parameters: ExpansoGeneratorInputSchema,

    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const description = readStringParam(params, "description", { required: true });
      const callApiKey = readStringParam(params, "apiKey") ?? defaultApiKey;

      // Delegate to the (potentially mocked) generator function.
      const pipeline = await generatePipeline(description, callApiKey);

      // Double-check the returned pipeline (guards against bad mock/override implementations).
      if (!Value.Check(ExpansoPipelineSchema, pipeline)) {
        const errors = [...Value.Errors(ExpansoPipelineSchema, pipeline)].map(
          (e) => `${e.path}: ${e.message}`,
        );
        throw new Error(`Generated pipeline failed schema validation:\n${errors.join("\n")}`);
      }

      // Serialise to YAML.
      const yamlText = yamlStringify(pipeline, {
        lineWidth: 0, // Prevent wrapping of long strings.
        defaultStringType: "QUOTE_DOUBLE",
        defaultKeyType: "PLAIN",
      });

      const result: ExpansoGeneratorResult = {
        pipeline,
        yaml: yamlText,
      };

      return jsonResult(result);
    },
  };
}
