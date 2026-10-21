import {
  claimNextPass,
  completePass,
  failPass,
  getReport,
  releaseInterruptedExtractions,
} from "../db/reports";
import { extractFocusedPass, extractPass } from "./extractor";

// Longer than any single LLM call (240s timeout x retries), so a live pass is
// never stolen; a crashed process's lease is cleared on restart instead.
const LEASE_MS = 20 * 60_000;

const globalForRunner = globalThis as unknown as { __ccRunning?: Set<string> };
const running = (globalForRunner.__ccRunning ??= new Set<string>());

/**
 * Work through a report's remaining passes in the background. Requires a
 * long-running Node server (not serverless): the loop outlives the request
 * that started it. Safe to call repeatedly; one loop per report per process.
 */
export function runExtraction(reportId: string): void {
  if (running.has(reportId)) return;
  running.add(reportId);
  void loop(reportId)
    .catch((err) => console.error(`[extract] ${reportId} runner crashed:`, err))
    .finally(() => running.delete(reportId));
}

async function loop(reportId: string): Promise<void> {
  const started = Date.now();
  const report = await getReport(reportId, ["pages", "chunks"]);
  if (!report) return;
  for (;;) {
    const claim = await claimNextPass(reportId, LEASE_MS, false);
    if (!claim) break;
    try {
      const plan = report.extractionPlan[claim.pass - 1];
      const newPoints =
        report.extractionMode === "focused" && plan
          ? await extractFocusedPass(
              report.pages,
              report.chunks,
              plan,
              claim.pass,
              claim.targetFields,
              claim.dataPoints,
            )
          : await extractPass(report.pages, claim.pass, claim.targetFields, claim.dataPoints);
      await completePass(reportId, claim.pass, claim.passesTotal, newPoints);
      console.log(
        `[extract] ${reportId} pass ${claim.pass}/${claim.passesTotal} done, +${newPoints.length} points`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "extraction failed";
      console.error(`[extract] ${reportId} pass ${claim.pass} failed:`, message);
      await failPass(reportId, `Pass ${claim.pass}/${claim.passesTotal}: ${message}`);
      return;
    }
  }
  console.log(`[extract] ${reportId} finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

export async function resumeInterruptedExtractions(): Promise<void> {
  const ids = await releaseInterruptedExtractions();
  if (ids.length > 0) console.log(`[extract] resuming ${ids.length} interrupted run(s)`);
  for (const id of ids) runExtraction(id);
}
