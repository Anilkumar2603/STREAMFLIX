import { prisma } from "../lib/prisma";
import {
  processVideo,
  resumeFailedVideoUpload,
} from "./process-video";

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

async function main() {
  const command = process.argv[2];
  const videoId = process.argv[3];

  // ==========================================
  // RESUME MODE
  // ==========================================
  if (command === "resume") {
    if (!videoId) {
      throw new Error(
        "Usage: npm run worker -- resume <videoId>"
      );
    }

    console.log("================================");
    console.log("===== RESUMING FAILED VIDEO =====");
    console.log("================================");
    console.log(`Video ID: ${videoId}`);
    console.log("================================");

    await resumeFailedVideoUpload(videoId);

    console.log("================================");
    console.log("===== RESUME COMPLETED =====");
    console.log("================================");

    return;
  }

  // ==========================================
  // NORMAL WORKER MODE
  // ==========================================
  await workerLoop();
}

main().catch((error) => {
  console.error("");
  console.error("================================");
  console.error("WORKER FATAL ERROR");
  console.error("================================");
  console.error(error);
  console.error("================================");

  process.exit(1);
});