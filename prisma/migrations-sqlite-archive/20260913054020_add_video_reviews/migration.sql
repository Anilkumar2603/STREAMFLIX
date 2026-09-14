-- CreateTable
CREATE TABLE "VideoReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "review" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoReview_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VideoReview_videoId_idx" ON "VideoReview"("videoId");

-- CreateIndex
CREATE INDEX "VideoReview_userId_idx" ON "VideoReview"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoReview_userId_videoId_key" ON "VideoReview"("userId", "videoId");
