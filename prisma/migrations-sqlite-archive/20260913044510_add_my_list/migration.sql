-- CreateTable
CREATE TABLE "MyList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MyList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MyList_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MyList_userId_idx" ON "MyList"("userId");

-- CreateIndex
CREATE INDEX "MyList_videoId_idx" ON "MyList"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "MyList_userId_videoId_key" ON "MyList"("userId", "videoId");
