import { GridFSBucket, MongoClient, type Db } from "mongodb";
import { decryptBuffer } from "./crypto.js";

const REPORTS_COLLECTION = "reports";
const PDF_BUCKET = "pdfs";

let clientPromise: Promise<MongoClient> | null = null;

function clientFactory(): MongoClient {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set on the embed-server.");
  }
  return new MongoClient(uri, { maxPoolSize: 4 });
}

export async function getDb(): Promise<Db> {
  if (!clientPromise) {
    clientPromise = clientFactory().connect();
  }
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB;
  if (!dbName) {
    throw new Error("MONGODB_DB is not set on the embed-server.");
  }
  return client.db(dbName);
}

export async function getReports(): Promise<
  ReturnType<Db["collection"]>
> {
  const db = await getDb();
  return db.collection(REPORTS_COLLECTION);
}

export async function getPdfBucket(): Promise<GridFSBucket> {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: PDF_BUCKET });
}

export async function downloadPdfBuffer(reportId: string): Promise<Buffer> {
  const bucket = await getPdfBucket();
  const files = await bucket.find({ filename: reportId }).toArray();
  if (files.length === 0) {
    throw new Error(`No PDF found in GridFS for reportId=${reportId}`);
  }
  const file = files[0];
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const stream = bucket.openDownloadStream(file._id);
    const parts: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => parts.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(parts)));
  });
  return file.metadata?.encrypted ? decryptBuffer(raw) : raw;
}
