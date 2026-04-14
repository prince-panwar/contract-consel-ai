// Node-only — isolated from the Edge runtime compile via the dispatcher in
// instrumentation.ts. Safe to use Node APIs here.

export {};

process.on("uncaughtException", (err) => {
  console.error("[process] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection:", reason);
});

import("@/lib/rag/vectorStore")
  .then(({ sweepStale }) => {
    const interval = setInterval(() => {
      try {
        sweepStale();
      } catch {
        /* ignore */
      }
    }, 5 * 60 * 1000);
    (interval as NodeJS.Timeout).unref?.();
  })
  .catch((err) => {
    console.error("[instrumentation-node] failed to load vectorStore:", err);
  });
