import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";

import {
  getStorageMode,
  getUploadState,
  listAllParts,
  type StorageMode,
} from "@/lib/r2";

export async function GET(
  request: Request
) {
  try {
    const admin =
      await requireAdminApi();

    if (admin instanceof Response) {
      return admin;
    }

    const storageMode: StorageMode =
      getStorageMode();

    const { searchParams } =
      new URL(request.url);

    const videoId =
      searchParams.get(
        "videoId"
      );

    if (!videoId) {
      return NextResponse.json(
        {
          error:
            "videoId is required",
        },
        { status: 400 }
      );
    }

    const video =
      await prisma.video.findUnique(
        {
          where: {
            id: videoId,
          },
        }
      );

    if (!video) {
      return NextResponse.json(
        {
          error:
            "Video not found",
        },
        { status: 404 }
      );
    }

    /* ==========================================
       R2
    ========================================== */

    if (
      storageMode === "r2"
    ) {
      if (video.status !== "UPLOADING") {
  return NextResponse.json({
    videoId,
    status: video.status,
    uploadedChunks: [],
    storageMode,
  });
}

let state;

try {
  state = await getUploadState(videoId);
} catch (error) {
  console.warn(
    "Upload state no longer exists. Returning empty upload status.",
    error
  );

  return NextResponse.json({
    videoId,
    status: video.status,
    uploadedChunks: [],
    storageMode,
  });
}

      const parts =
        await listAllParts(
          state.objectKey,
          state.uploadId
        );

      const uploadedChunks =
        parts
          .map(
            (part) =>
              typeof part.PartNumber ===
              "number"
                ? part.PartNumber - 1
                : null
          )
          .filter(
            (
              value
            ): value is number =>
              value !== null
          )
          .sort(
            (a, b) => a - b
          );

      return NextResponse.json({
        videoId,
        status:
          video.status,
        uploadedChunks,
        storageMode,
      });
    }

    /* ==========================================
       LOCAL
    ========================================== */

    const uploadDir =
      path.join(
        process.cwd(),
        "uploads",
        videoId
      );

    let files: string[] =
      [];

    try {
      files =
        await fs.readdir(
          uploadDir
        );
    } catch {
      files = [];
    }

    const uploadedChunks =
      files
        .filter((file) =>
          /^chunk-\d+$/.test(
            file
          )
        )
        .map((file) =>
          Number(
            file.replace(
              "chunk-",
              ""
            )
          )
        )
        .filter((index) =>
          Number.isInteger(
            index
          )
        )
        .sort(
          (a, b) => a - b
        );

    return NextResponse.json({
      videoId,
      status:
        video.status,
      uploadedChunks,
      storageMode,
    });
  } catch (error) {
    console.error(
      "Upload status error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to get upload status",
      },
      { status: 500 }
    );
  }
}