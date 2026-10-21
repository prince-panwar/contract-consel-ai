// One-off: encrypt contract data stored before CONTENT_ENCRYPTION_KEY was set.
// Idempotent (already-encrypted values are skipped). Writes a plain backup of
// everything it touches to BACKUP_DIR first.
//
//   BACKUP_DIR=~/backups/cc-$(date +%F) npx tsx bin/encrypt-existing.ts [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Document } from "mongodb";
import { getDb, getPdfBucket } from "../lib/db/mongo";
import { encryptBuffer, encryptionEnabled, encryptText, isEncryptedText } from "../lib/crypto/content";

const dryRun = process.argv.includes("--dry-run");

function seal(value: unknown): unknown {
  return typeof value === "string" && !isEncryptedText(value) ? encryptText(value) : value;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

async function main() {
  if (!encryptionEnabled()) throw new Error("CONTENT_ENCRYPTION_KEY is not set.");
  const backupDir = process.env.BACKUP_DIR;
  if (!backupDir) throw new Error("Set BACKUP_DIR for the pre-migration backup.");
  fs.mkdirSync(path.join(backupDir, "pdfs"), { recursive: true, mode: 0o700 });

  const db = await getDb();
  const reports = db.collection<Document>("reports");
  const bucket = await getPdfBucket();

  const docs = await reports.find({}).toArray();
  fs.writeFileSync(path.join(backupDir, "reports.json"), JSON.stringify(docs), { mode: 0o600 });
  console.log(`backed up ${docs.length} reports`);

  let changed = 0;
  for (const d of docs) {
    const running = d.extractionStatus === "running" || d.extractionStatus === "pending";
    if (running) {
      console.log(`skip ${d.reportId}: extraction running`);
      continue;
    }
    const set = {
      filename: seal(d.filename),
      pages: (d.pages ?? []).map((p: Document) => ({ ...p, text: seal(p.text) })),
      chunks: (d.chunks ?? []).map((c: Document) => ({
        ...c,
        text: seal(c.text),
        heading: c.heading == null ? null : seal(c.heading),
      })),
      dataPoints: (d.dataPoints ?? []).map((p: Document) => ({
        ...p,
        value: seal(p.value),
        quote: seal(p.quote),
      })),
    };
    if (JSON.stringify(set) === JSON.stringify({ filename: d.filename, pages: d.pages ?? [], chunks: d.chunks ?? [], dataPoints: d.dataPoints ?? [] })) continue;
    changed++;
    console.log(`${dryRun ? "[dry] " : ""}encrypt report ${d.reportId}`);
    if (!dryRun) await reports.updateOne({ _id: d._id }, { $set: set });
  }

  let pdfs = 0;
  for (const f of await bucket.find({}).toArray()) {
    if (f.metadata?.encrypted) continue;
    const plain = await readAll(bucket.openDownloadStream(f._id));
    fs.writeFileSync(path.join(backupDir, "pdfs", `${f.filename}.pdf`), plain, { mode: 0o600 });
    pdfs++;
    console.log(`${dryRun ? "[dry] " : ""}encrypt pdf ${f.filename} (${plain.length} bytes)`);
    if (dryRun) continue;
    const { data } = encryptBuffer(plain);
    await new Promise<void>((resolve, reject) => {
      const up = bucket.openUploadStream(f.filename, {
        metadata: { ...(f.metadata ?? {}), encrypted: true },
      });
      Readable.from(data).pipe(up).on("error", reject).on("finish", () => resolve());
    });
    await bucket.delete(f._id);
  }
  console.log(`done: ${changed} report(s), ${pdfs} pdf(s)${dryRun ? " (dry run, nothing written)" : ""}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
