/**
 * Tests for the Expanso NL-to-Pipeline Generator tool (US-002).
 *
 * Strategy: inject a mock `generatePipeline` function via
 * `createExpansoGeneratorTool({ generatePipeline: mockFn })` so tests run
 * without real LLM calls. A separate suite validates the YAML serialisation
 * and schema guard behaviour.
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";
import { parse as yamlParse } from "yaml";
import {
  createExpansoGeneratorTool,
  type ExpansoGeneratorResult,
  type ExpansoGeneratorToolOptions,
} from "./expanso-generator.js";
import { ExpansoPipelineSchema, type ExpansoPipeline } from "./expanso-schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid pipeline fixture used across multiple tests. */
const MINIMAL_PIPELINE: ExpansoPipeline = {
  name: "stdin-to-stdout",
  inputs: [{ name: "stdin-in", type: "stdin" }],
  outputs: [{ name: "stdout-out", type: "stdout" }],
};

/** CSV-to-JSON pipeline fixture (matches acceptance criterion #1). */
const CSV_TO_JSON_PIPELINE: ExpansoPipeline = {
  name: "csv-to-json-pipeline",
  description: "Reads CSV files and converts each row to JSON",
  inputs: [
    {
      name: "csv-file-in",
      type: "file",
      config: { path: "/data/input.csv", codec: "csv" },
    },
  ],
  transforms: [
    {
      name: "to-json",
      type: "bloblang",
      config: { mapping: "root = this" },
    },
  ],
  outputs: [
    {
      name: "json-stdout-out",
      type: "stdout",
    },
  ],
};

/**
 * Invoke the tool's `execute` function with a given description and optional
 * per-call apiKey. Returns the parsed `ExpansoGeneratorResult`.
 */
async function runTool(
  opts: ExpansoGeneratorToolOptions,
  description: string,
  apiKey?: string,
): Promise<ExpansoGeneratorResult> {
  const tool = createExpansoGeneratorTool(opts);
  const params: Record<string, unknown> = { description };
  if (apiKey !== undefined) {
    params["apiKey"] = apiKey;
  }
  const toolResult = await tool.execute("test-call-id", params as never);
  // `jsonResult` wraps in content[0].text as JSON.
  const content = toolResult.content[0];
  if (content.type !== "text") {
    throw new Error("Expected text content from tool");
  }
  return JSON.parse(content.text) as ExpansoGeneratorResult;
}

// ---------------------------------------------------------------------------
// Tool construction
// ---------------------------------------------------------------------------

describe("createExpansoGeneratorTool — tool metadata", () => {
  it("creates a tool with the expected name", () => {
    const tool = createExpansoGeneratorTool();
    expect(tool.name).toBe("expanso_generate");
  });

  it("creates a tool with a non-empty label", () => {
    const tool = createExpansoGeneratorTool();
    expect(tool.label.length).toBeGreaterThan(0);
  });

  it("creates a tool with a descriptive description", () => {
    const tool = createExpansoGeneratorTool();
    expect(tool.description).toContain("pipeline");
  });

  it("creates a tool with a parameters schema", () => {
    const tool = createExpansoGeneratorTool();
    expect(tool.parameters).toBeDefined();
  });

  it("creates a tool with an execute function", () => {
    const tool = createExpansoGeneratorTool();
    expect(typeof tool.execute).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Pipeline generation via injected mock
// ---------------------------------------------------------------------------

describe("createExpansoGeneratorTool — pipeline generation", () => {
  it("returns a result with pipeline and yaml fields", async () => {
    const result = await runTool(
      { generatePipeline: async () => MINIMAL_PIPELINE },
      "Simple stdin to stdout passthrough",
    );

    expect(result).toHaveProperty("pipeline");
    expect(result).toHaveProperty("yaml");
  });

  it("returns the pipeline object matching ExpansoPipelineSchema", async () => {
    const result = await runTool(
      { generatePipeline: async () => MINIMAL_PIPELINE },
      "stdin to stdout",
    );

    expect(Value.Check(ExpansoPipelineSchema, result.pipeline)).toBe(true);
  });

  it("generates valid YAML that round-trips back to the pipeline object", async () => {
    const result = await runTool(
      { generatePipeline: async () => MINIMAL_PIPELINE },
      "stdin to stdout",
    );

    const parsed = yamlParse(result.yaml) as unknown;
    expect(Value.Check(ExpansoPipelineSchema, parsed)).toBe(true);
  });

  it("round-tripped YAML contains the original pipeline name", async () => {
    const result = await runTool(
      { generatePipeline: async () => MINIMAL_PIPELINE },
      "stdin to stdout",
    );

    const parsed = yamlParse(result.yaml) as ExpansoPipeline;
    expect(parsed.name).toBe(MINIMAL_PIPELINE.name);
  });

  it("converts a 'CSV to JSON' description to a valid pipeline (acceptance criterion #1)", async () => {
    const result = await runTool(
      { generatePipeline: async () => CSV_TO_JSON_PIPELINE },
      "CSV to JSON",
    );

    expect(Value.Check(ExpansoPipelineSchema, result.pipeline)).toBe(true);

    // Ensure the pipeline has the expected structure for CSV-to-JSON
    expect(result.pipeline.inputs[0]?.type).toContain("file");
    expect(result.pipeline.outputs[0]?.type).toBe("stdout");
  });

  it("YAML output from CSV-to-JSON pipeline is parseable and valid", async () => {
    const result = await runTool(
      { generatePipeline: async () => CSV_TO_JSON_PIPELINE },
      "Read CSV files and output as JSON",
    );

    const parsed = yamlParse(result.yaml) as unknown;
    expect(Value.Check(ExpansoPipelineSchema, parsed)).toBe(true);
  });

  it("passes the description to the generator function", async () => {
    const receivedDescriptions: string[] = [];
    await runTool(
      {
        generatePipeline: async (desc) => {
          receivedDescriptions.push(desc);
          return MINIMAL_PIPELINE;
        },
      },
      "read from kafka write to s3",
    );

    expect(receivedDescriptions).toHaveLength(1);
    expect(receivedDescriptions[0]).toBe("read from kafka write to s3");
  });

  it("forwards the per-call apiKey to the generator function", async () => {
    const receivedKeys: Array<string | undefined> = [];
    await runTool(
      {
        generatePipeline: async (_desc, key) => {
          receivedKeys.push(key);
          return MINIMAL_PIPELINE;
        },
      },
      "any description",
      "sk-test-key",
    );

    expect(receivedKeys[0]).toBe("sk-test-key");
  });

  it("falls back to the default apiKey when no per-call key is provided", async () => {
    const receivedKeys: Array<string | undefined> = [];
    await runTool(
      {
        apiKey: "default-key",
        generatePipeline: async (_desc, key) => {
          receivedKeys.push(key);
          return MINIMAL_PIPELINE;
        },
      },
      "any description",
    );

    expect(receivedKeys[0]).toBe("default-key");
  });

  it("generates YAML that includes transform names when transforms are present", async () => {
    const result = await runTool(
      { generatePipeline: async () => CSV_TO_JSON_PIPELINE },
      "CSV to JSON with transform",
    );

    expect(result.yaml).toContain("to-json");
    expect(result.yaml).toContain("bloblang");
  });

  it("generates YAML that includes input config values", async () => {
    const result = await runTool(
      { generatePipeline: async () => CSV_TO_JSON_PIPELINE },
      "CSV to JSON",
    );

    expect(result.yaml).toContain("/data/input.csv");
    expect(result.yaml).toContain("csv");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("createExpansoGeneratorTool — error handling", () => {
  it("propagates errors thrown by the generator function", async () => {
    await expect(
      runTool(
        {
          generatePipeline: async () => {
            throw new Error("LLM call failed");
          },
        },
        "any description",
      ),
    ).rejects.toThrow("LLM call failed");
  });

  it("rejects a pipeline that does not conform to ExpansoPipelineSchema", async () => {
    await expect(
      runTool(
        {
          generatePipeline: async () => {
            // Missing required `outputs` field — invalid pipeline.
            return {
              name: "bad-pipeline",
              inputs: [{ name: "in", type: "stdin" }],
            } as unknown as ExpansoPipeline;
          },
        },
        "bad pipeline",
      ),
    ).rejects.toThrow(/schema validation/i);
  });

  it("rejects a pipeline with empty inputs array", async () => {
    await expect(
      runTool(
        {
          generatePipeline: async () => {
            return {
              name: "no-inputs",
              inputs: [],
              outputs: [{ name: "out", type: "stdout" }],
            } as unknown as ExpansoPipeline;
          },
        },
        "no inputs",
      ),
    ).rejects.toThrow(/schema validation/i);
  });

  it("throws when description is missing", async () => {
    const tool = createExpansoGeneratorTool({
      generatePipeline: vi.fn().mockResolvedValue(MINIMAL_PIPELINE),
    });

    await expect(tool.execute("call-id", {} as never)).rejects.toThrow(/description required/i);
  });
});

// ---------------------------------------------------------------------------
// YAML output format
// ---------------------------------------------------------------------------

describe("createExpansoGeneratorTool — YAML output format", () => {
  it("produces multi-line YAML (not a single-line JSON dump)", async () => {
    const result = await runTool(
      { generatePipeline: async () => CSV_TO_JSON_PIPELINE },
      "CSV to JSON",
    );

    // Multi-line YAML should have at least one newline
    expect(result.yaml).toContain("\n");
  });

  it("YAML contains top-level pipeline keys in expected order", async () => {
    const result = await runTool(
      { generatePipeline: async () => CSV_TO_JSON_PIPELINE },
      "CSV to JSON",
    );

    const nameIdx = result.yaml.indexOf("name:");
    const inputsIdx = result.yaml.indexOf("inputs:");
    const outputsIdx = result.yaml.indexOf("outputs:");

    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(inputsIdx).toBeGreaterThan(nameIdx);
    expect(outputsIdx).toBeGreaterThan(inputsIdx);
  });

  it("YAML round-trips correctly for a pipeline with metadata", async () => {
    const pipelineWithMeta: ExpansoPipeline = {
      ...MINIMAL_PIPELINE,
      name: "meta-pipeline",
      metadata: { version: "2.0", team: "data-eng" },
    };

    const result = await runTool(
      { generatePipeline: async () => pipelineWithMeta },
      "pipeline with metadata",
    );

    const parsed = yamlParse(result.yaml) as ExpansoPipeline;
    expect(parsed.metadata?.["version"]).toBe("2.0");
    expect(parsed.metadata?.["team"]).toBe("data-eng");
  });
});
