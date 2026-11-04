// Job 002e: the Anthropic adapter's `app` request, built without any network call: the app
// schema is asked for, the base version and instructions travel as data, and check values sent
// as JSON text are parsed back (unreadable text stays visibly unreadable, never a silent pass).

import { describe, expect, it } from "vitest";
import { APP_JSON_SCHEMA, requestBody, reshapeApp, userContent } from "../src/anthropic.ts";
import type { BuildRequest } from "../src/build.ts";
import { QUOTE_BUNDLE } from "./app-fixtures.ts";

const req: BuildRequest = {
  jobId: "j",
  attempt: 1,
  dispatchKey: "j:1",
  projectId: "p",
  businessId: "b",
  revision: 1,
  contentHash: "h",
  content: {} as BuildRequest["content"],
  intent: "app",
  conversation: [],
  limits: { maxInputTokens: 1000, maxOutputTokens: 500, maxSeconds: 30 },
  outputSchema: "web_app_bundle/1",
  app: {
    instructions: "Make colour cheaper",
    base: { job: "j0", digest: "d", bundle: QUOTE_BUNDLE },
  },
};

describe("002e Anthropic adapter, app intent (no network)", () => {
  it("asks for the app schema, with the base version and instructions as data", () => {
    const body = requestBody(req, {
      model: "claude-haiku-5-5",
      thinking: { type: "disabled" },
      effort: "medium",
    } as never);
    expect(body.output_config.format.schema).toBe(APP_JSON_SCHEMA);
    expect(JSON.parse(userContent(req))).toMatchObject({
      founder_instructions: "Make colour cheaper",
      base: { name: QUOTE_BUNDLE.name },
    });
  });

  it("parses check values back from JSON text; unreadable text stays marked unreadable", () => {
    const back = reshapeApp({
      ...QUOTE_BUNDLE,
      checks: [
        {
          id: "a",
          label: "A",
          module: "quote.js",
          export: "quote",
          input_json: JSON.stringify({ copies: 1 }),
          expect_json: "not json",
        },
      ],
    }) as { checks: Record<string, unknown>[] };
    expect(back.checks[0]).toMatchObject({
      input: { copies: 1 },
      expect: { unreadable_json: "not json" },
    });
    expect(back.checks[0]).not.toHaveProperty("input_json");
  });
});
