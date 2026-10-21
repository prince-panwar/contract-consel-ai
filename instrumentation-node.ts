// Node-only — isolated from the Edge runtime compile via the dispatcher in
// instrumentation.ts. Safe to use Node APIs here.

export {};

process.on("uncaughtException", (err) => {
  console.error("[process] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection:", reason);
});

// Pick up extraction runs a restart or deploy interrupted.
void import("./lib/extract/runner")
  .then((m) => m.resumeInterruptedExtractions())
  .catch((err) => console.error("[extract] resume on boot failed:", err));
