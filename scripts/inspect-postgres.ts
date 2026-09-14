import pg from "pg";
import "dotenv/config";

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
});

async function main() {
  await client.connect();

  const result = await client.query(
    "SELECT table_schema, table_name FROM information_schema.tables ORDER BY table_schema, table_name"
  );

  console.log("Tables in Supabase PostgreSQL:");

  for (const row of result.rows) {
    if (row.table_schema !== "pg_catalog" && row.table_schema !== "information_schema") {
      console.log(row.table_schema + "." + row.table_name);
    }
  }

  await client.end();
}

main().catch(async (error) => {
  console.error("Inspection failed:", error);
  await client.end().catch(() => {});
  process.exit(1);
});
