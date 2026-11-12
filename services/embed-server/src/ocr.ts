import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * OCR for scanned pages. A scanned contract has no text layer, so it used to
 * fail with "No readable text found". Pages with (almost) no text are rendered
 * with pdftoppm and read with Tesseract, both installed in the Docker image.
 * Without those binaries, OCR is skipped and the page stays empty.
 */

const run = promisify(execFile);

// Fewer non-space characters than this means the page has no usable text layer.
export const MIN_TEXT_CHARS = 25;

export function needsOcr(text: string): boolean {
  return text.replace(/\s+/g, "").length < MIN_TEXT_CHARS;
}

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let available: Promise<boolean> | null = null;

export function ocrAvailable(): Promise<boolean> {
  if (process.env.OCR_DISABLED === "true") return Promise.resolve(false);
  available ??= Promise.all([run("tesseract", ["--version"]), run("pdftoppm", ["-v"])])
    .then(() => true)
    .catch(() => false);
  return available;
}

/**
 * OCR the given 1-based pages. Returns page number → text for the pages that
 * produced text; failures leave a page out rather than failing the upload.
 */
export async function ocrPages(pdf: Buffer, pageNumbers: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pageNumbers.length === 0 || !(await ocrAvailable())) return out;
  const maxPages = intEnv("OCR_MAX_PAGES", 300);
  const timeout = intEnv("OCR_PAGE_TIMEOUT_MS", 120_000);
  const lang = process.env.OCR_LANG || "eng";
  const dir = await mkdtemp(path.join(tmpdir(), "ocr-"));
  try {
    const file = path.join(dir, "in.pdf");
    await writeFile(file, pdf);
    for (const n of pageNumbers.slice(0, maxPages)) {
      try {
        const prefix = path.join(dir, `p${n}`);
        // 300 dpi greyscale is Tesseract's sweet spot for printed contracts.
        await run("pdftoppm", ["-r", "300", "-gray", "-png", "-singlefile", "-f", String(n), "-l", String(n), file, prefix], {
          timeout,
        });
        const { stdout } = await run("tesseract", [`${prefix}.png`, "stdout", "-l", lang, "--psm", "3"], {
          timeout,
          maxBuffer: 16 * 1024 * 1024,
        });
        const text = stdout.replace(/\f/g, "").trim();
        if (text) out.set(n, text);
        await rm(`${prefix}.png`, { force: true });
      } catch (err) {
        console.warn(`[ocr] page ${n} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (pageNumbers.length > maxPages) {
      console.warn(`[ocr] ${pageNumbers.length - maxPages} scanned page(s) over OCR_MAX_PAGES were skipped`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return out;
}
