import { createDatabase } from "./client.ts";
import { migrateDatabase } from "./migrator.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const { db, close } = createDatabase(url);
try {
  await migrateDatabase(db);
  console.log("migrations applied");
} finally {
  await close();
}
