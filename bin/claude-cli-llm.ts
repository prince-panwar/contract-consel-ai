/**
 * Benchmark-only LLM backend: runs each request through headless Claude Code
 * (`claude -p`) with the same system prompt and JSON schema the app sends.
 * Used to measure models on PUBLIC benchmark contracts without an API key;
 * never wired into the application (client data must go through the API).
 */
import { spawn } from "node:child_process";
import type { JsonRequest, JsonResult } from "../lib/llm/client";

export const spend = { usd: 0, calls: 0 };

export function claudeCliDispatcher(model: string, timeoutMs = 20 * 60_000) {
  return (req: JsonRequest): Promise<JsonResult<unknown>> =>
    new Promise((resolve, reject) => {
      const args = [
        "-p",
        "--model",
        model,
        "--system-prompt",
        req.system,
        "--json-schema",
        JSON.stringify(req.schema),
        "--output-format",
        "json",
        "--effort",
        req.effort,
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--setting-sources",
        "",
      ];
      const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const r = JSON.parse(out) as {
            is_error?: boolean;
            result?: string;
            structured_output?: unknown;
            total_cost_usd?: number;
            stop_reason?: string;
            usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number };
          };
          spend.usd += r.total_cost_usd ?? 0;
          spend.calls += 1;
          if (r.is_error) throw new Error(`claude -p error: ${String(r.result).slice(0, 300)}`);
          const data = r.structured_output ?? JSON.parse(r.result ?? "");
          const u = r.usage ?? {};
          resolve({
            data,
            model,
            stopReason: r.stop_reason ?? "end_turn",
            inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            outputTokens: u.output_tokens,
          });
        } catch (e) {
          reject(new Error(`claude -p failed (exit ${code}): ${e instanceof Error ? e.message : e} ${err.slice(0, 300)}`));
        }
      });
      child.stdin.end(req.userMessage);
    });
}
