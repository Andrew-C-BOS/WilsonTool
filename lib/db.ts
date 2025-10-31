import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI!;
const dbName = process.env.MONGODB_DB!;

if (!uri) throw new Error("Missing MONGODB_URI");
if (!dbName) throw new Error("Missing MONGODB_DB");

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  client ??= new MongoClient(uri, { maxPoolSize: 10 });
  // @ts-ignore optional on first connect
  if (!client.topology?.isConnected?.()) await client.connect();
  db = client.db(dbName);
  return db;
}
