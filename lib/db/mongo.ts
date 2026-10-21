import {
  MongoClient,
  GridFSBucket,
  type Db,
  type Collection,
  type Document,
} from "mongodb";

const COLLECTIONS = {
  reports: "reports",
  admins: "admins",
  pdfBucket: "pdfs",
} as const;

const globalForMongo = globalThis as unknown as {
  __ccMongoClient?: MongoClient;
  __ccMongoConnect?: Promise<MongoClient>;
};

function clientFactory(): MongoClient {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add it to .env (see .env.example).",
    );
  }
  return new MongoClient(uri, {
    maxPoolSize: 10,
  });
}

async function getClient(): Promise<MongoClient> {
  if (globalForMongo.__ccMongoClient) return globalForMongo.__ccMongoClient;
  if (!globalForMongo.__ccMongoConnect) {
    globalForMongo.__ccMongoConnect = clientFactory()
      .connect()
      .then((c) => {
        globalForMongo.__ccMongoClient = c;
        return c;
      });
  }
  return globalForMongo.__ccMongoConnect;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  const dbName = process.env.MONGODB_DB || "contract_counsel";
  return client.db(dbName);
}

const globalForIndexes = globalThis as unknown as { __ccIndexes?: Promise<unknown> };

export async function getReports<T extends Document = Document>(): Promise<Collection<T>> {
  const db = await getDb();
  const col = db.collection<T>(COLLECTIONS.reports);
  // Without these every reportId lookup is a collection scan over multi-MB
  // docs. createIndex is idempotent; run once per process.
  globalForIndexes.__ccIndexes ??= Promise.all([
    col.createIndex({ reportId: 1 }),
    col.createIndex({ lastAccessAt: -1 }),
    col.createIndex({ ownerUid: 1 }),
    col.createIndex({ sharedWith: 1 }),
  ]).catch((err) => {
    globalForIndexes.__ccIndexes = undefined;
    console.error("[mongo] createIndex failed:", err);
  });
  await globalForIndexes.__ccIndexes;
  return col;
}

export async function getAdmins<T extends Document = Document>(): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(COLLECTIONS.admins);
}

export async function getPdfBucket(): Promise<GridFSBucket> {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: COLLECTIONS.pdfBucket });
}

export const collectionNames = COLLECTIONS;
