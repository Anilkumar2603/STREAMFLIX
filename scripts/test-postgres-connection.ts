import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });

  console.log("Connecting to PostgreSQL...");

  try {
    await client.connect();
    console.log("CONNECTED");

    const result = await client.query(
      "SELECT current_database(), current_user, version()"
    );

    console.log("QUERY SUCCESSFUL");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("CONNECTION/QUERY FAILED");
    console.error(error);
  } finally {
    await client.end().catch(() => {});
  }
}

main();