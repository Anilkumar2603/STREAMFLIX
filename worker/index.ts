import { prisma } from "../lib/prisma";
import { processVideo } from "./process-video";

const POLL_INTERVAL = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerLoop() {
  console.log("================================");
  console.log("VIDEO PROCESSING WORKER");
  console.log("================================");
  console.log("Worker started.");
  console.log("Waiting for videos...");
  console.log("================================");

  while (true) {
    try {
      const video = await prisma.video.findFirst({
        where: {
          status: "PROCESSING",
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (!video) {
        // Nothing to process.
        // Don't print anything here.
        // This prevents terminal flickering.
        await sleep(POLL_INTERVAL);
        continue;
      }

      console.log("");
      console.log("================================");
      console.log("VIDEO FOUND");
      console.log("================================");
      console.log(`ID: ${video.id}`);
      console.log(`Title: ${video.title}`);
      console.log(`Status: ${video.status}`);
      console.log("================================");

      try {
        await processVideo(video.id);

        console.log("");
        console.log("================================");
        console.log("PROCESSING COMPLETE");
        console.log(`Video: ${video.title}`);
        console.log("Status: READY");
        console.log("================================");
      } catch (error) {
        console.error("");
        console.error("================================");
        console.error("PROCESSING ERROR");
        console.error(`Video: ${video.title}`);
        console.error(error);
        console.error("================================");
      }

      // Small delay before checking for another video.
      await sleep(1000);
    } catch (error) {
      console.error("");
      console.error("================================");
      console.error("WORKER ERROR");
      console.error(error);
      console.error("================================");

      await sleep(POLL_INTERVAL);
    }
  }
}

workerLoop().catch((error) => {
  console.error("Worker stopped unexpectedly:", error);
  process.exit(1);
});