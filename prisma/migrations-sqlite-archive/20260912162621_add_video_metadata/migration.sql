-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "genre" TEXT,
    "releaseYear" INTEGER,
    "ageRating" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "originalFile" TEXT NOT NULL,
    "streamPath" TEXT,
    "thumbnailPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "duration" REAL,
    "progress" REAL NOT NULL DEFAULT 0,
    "processingFps" REAL,
    "processingSpeed" REAL,
    "processingElapsed" REAL,
    "processingEta" REAL,
    "processingStage" TEXT,
    "encoderUsed" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Video" ("createdAt", "duration", "encoderUsed", "id", "originalFile", "processingElapsed", "processingEta", "processingFps", "processingSpeed", "processingStage", "progress", "status", "streamPath", "thumbnailPath", "title") SELECT "createdAt", "duration", "encoderUsed", "id", "originalFile", "processingElapsed", "processingEta", "processingFps", "processingSpeed", "processingStage", "progress", "status", "streamPath", "thumbnailPath", "title" FROM "Video";
DROP TABLE "Video";
ALTER TABLE "new_Video" RENAME TO "Video";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
