/**
 * One-time data migration from the existing local SQLite database to PostgreSQL.
 *
 * This script intentionally does NOT migrate Session rows. Existing browser
 * sessions are local-environment state and should be invalidated when moving
 * to production; users can simply log in again.
 *
 * Required environment variables:
 *   SQLITE_DATABASE_URL   optional, defaults to file:./dev.db
 *   DIRECT_URL            Supabase direct/session PostgreSQL URL
 */
import "dotenv/config";
import Database from "better-sqlite3";
import pg from "pg";

const { Client } = pg;

function sqliteFilePath(url: string) {
  if (!url.startsWith("file:")) return url;
  return url.slice("file:".length).split("?")[0];
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return date;
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
}

async function main() {
  const sqliteUrl = process.env.SQLITE_DATABASE_URL || "file:./dev.db";
  const sqlitePath = sqliteFilePath(sqliteUrl);
 const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error("DIRECT_URL is required for the migration.");
  }

  console.log(`SQLite source: ${sqlitePath}`);
  console.log("PostgreSQL target: configured DIRECT_URL (value not printed)");

  const sqlite = new Database(sqlitePath, { readonly: true });
  const client = new Client({ connectionString: directUrl });

  await client.connect();

  try {
    await client.query("BEGIN");

    const users = sqlite.prepare('SELECT * FROM "User"').all() as any[];
    const videos = sqlite.prepare('SELECT * FROM "Video"').all() as any[];
    const myList = sqlite.prepare('SELECT * FROM "MyList"').all() as any[];
    const watchProgress = sqlite.prepare('SELECT * FROM "WatchProgress"').all() as any[];
    const reviews = sqlite.prepare('SELECT * FROM "VideoReview"').all() as any[];
    const subtitles = sqlite.prepare('SELECT * FROM "Subtitle"').all() as any[];

    console.log(`Found: ${users.length} users, ${videos.length} videos, ${myList.length} My List rows, ${watchProgress.length} watch-progress rows, ${reviews.length} reviews, ${subtitles.length} subtitles.`);

    for (const row of users) {
      await client.query(
        `INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ("id") DO NOTHING`,
        [row.id, row.name, row.email, row.passwordHash, row.role ?? "USER", asDate(row.createdAt), asDate(row.updatedAt)],
      );
    }

    for (const row of videos) {
      await client.query(
        `INSERT INTO "Video" ("id", "title", "description", "genre", "releaseYear", "ageRating", "featured", "published", "originalFile", "streamPath", "thumbnailPath", "status", "duration", "progress", "processingFps", "processingSpeed", "processingElapsed", "processingEta", "processingStage", "encoderUsed", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT ("id") DO NOTHING`,
        [
          row.id,
          row.title,
          row.description ?? null,
          row.genre ?? null,
          row.releaseYear ?? null,
          row.ageRating ?? null,
          asBoolean(row.featured),
          asBoolean(row.published),
          row.originalFile,
          row.streamPath ?? null,
          row.thumbnailPath ?? null,
          row.status ?? "PROCESSING",
          row.duration ?? null,
          row.progress ?? 0,
          row.processingFps ?? null,
          row.processingSpeed ?? null,
          row.processingElapsed ?? null,
          row.processingEta ?? null,
          row.processingStage ?? null,
          row.encoderUsed ?? null,
          asDate(row.createdAt),
        ],
      );
    }

    for (const row of myList) {
      await client.query(
        `INSERT INTO "MyList" ("id", "userId", "videoId", "createdAt")
         VALUES ($1,$2,$3,$4)
         ON CONFLICT ("id") DO NOTHING`,
        [row.id, row.userId, row.videoId, asDate(row.createdAt)],
      );
    }

    for (const row of watchProgress) {
      await client.query(
        `INSERT INTO "WatchProgress" ("id", "userId", "videoId", "positionSeconds", "durationSeconds", "completed", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT ("id") DO NOTHING`,
        [
          row.id,
          row.userId,
          row.videoId,
          row.positionSeconds ?? 0,
          row.durationSeconds ?? null,
          asBoolean(row.completed),
          asDate(row.createdAt),
          asDate(row.updatedAt),
        ],
      );
    }

    for (const row of reviews) {
      await client.query(
        `INSERT INTO "VideoReview" ("id", "userId", "videoId", "rating", "review", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ("id") DO NOTHING`,
        [row.id, row.userId, row.videoId, row.rating, row.review ?? null, asDate(row.createdAt), asDate(row.updatedAt)],
      );
    }

    for (const row of subtitles) {
      await client.query(
        `INSERT INTO "Subtitle" ("id", "videoId", "language", "label", "filePath", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ("id") DO NOTHING`,
        [row.id, row.videoId, row.language, row.label, row.filePath, asDate(row.createdAt), asDate(row.updatedAt)],
      );
    }

    await client.query("COMMIT");

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM "User") AS users,
        (SELECT COUNT(*) FROM "Video") AS videos,
        (SELECT COUNT(*) FROM "MyList") AS my_list,
        (SELECT COUNT(*) FROM "WatchProgress") AS watch_progress,
        (SELECT COUNT(*) FROM "VideoReview") AS reviews,
        (SELECT COUNT(*) FROM "Subtitle") AS subtitles,
        (SELECT COUNT(*) FROM "Session") AS sessions
    `);

    console.log("Migration completed successfully.");
    console.table(counts.rows[0]);
    console.log("Session rows were intentionally not migrated; users will need to log in again.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    sqlite.close();
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
