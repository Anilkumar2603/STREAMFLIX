-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "originalFile" TEXT NOT NULL,
    "streamPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "duration" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
