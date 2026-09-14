import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";

const { Client } = pg;

async function main() {
  const connectionString = process.env.DIRECT_URL;

  if (!connectionString) {
    throw new Error("DIRECT_URL is not configured");
  }

  const migrationName = "20260913000000_postgresql_init";

  const sqlPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    migrationName,
    "migration.sql"
  );

  const migrationSql = fs.readFileSync(sqlPath, "utf8");

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });

  await client.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
      )
    `);

    const existing = await client.query(
      `SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = $1`,
      [migrationName]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error(`Migration ${migrationName} is already recorded.`);
    }

    const crypto = await import("crypto");
    const checksum = crypto
      .createHash("sha256")
      .update(migrationSql)
      .digest("hex");

    const migrationId = crypto.randomUUID();

    await client.query(migrationSql);

    await client.query(
      `
      INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
      VALUES
        ($1, $2, now(), $3, 1)
      `,
      [migrationId, checksum, migrationName]
    );

    await client.query("COMMIT");

    console.log("SUCCESS");
    console.log(`Applied migration: ${migrationName}`);
    console.log("STREAMFLIX PostgreSQL tables are now created.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("BOOTSTRAP FAILED");
  console.error(error);
  process.exit(1);
});