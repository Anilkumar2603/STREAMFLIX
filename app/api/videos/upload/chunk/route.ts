import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";
import { getStorageMode } from "@/lib/r2";

export async function POST(
  request: NextRequest
) {
  try {
    await requireAdminApi();

    const storageMode =
      getStorageMode();

    /*
     * R2 uploads are now performed directly
     * by the browser → Cloudflare Worker.
     *
     * This endpoint remains available only
     * for LOCAL mode.
     */

    if (storageMode === "r2") {
      return NextResponse.json(
        {
          error:
            "R2 chunks must be uploaded directly to the storage Worker.",
        },
        { status: 410 }
      );
    }

    /* --------------------------------------------------
       LOCAL MODE
    -------------------------------------------------- */

    const formData =
      await request.formData();

    const videoId = String(
      formData.get("videoId") || ""
    );

    const chunkIndex = Number(
      formData.get("chunkIndex")
    );

    const chunk =
      formData.get("chunk");

    if (!videoId) {
      return NextResponse.json(
        {
          error:
            "videoId is required",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(
        chunkIndex
      ) ||
      chunkIndex < 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid chunkIndex",
        },
        { status: 400 }
      );
    }

    if (!(chunk instanceof File)) {
      return NextResponse.json(
        {
          error:
            "chunk file is required",
        },
        { status: 400 }
      );
    }

    const video =
      await prisma.video.findUnique({
        where: {
          id: videoId,
        },
      });

    if (!video) {
      return NextResponse.json(
        {
          error:
            "Video not found",
        },
        { status: 404 }
      );
    }

    if (
      video.status !==
      "UPLOADING"
    ) {
      return NextResponse.json(
        {
          error:
            `Video is not uploading. Current status: ${video.status}`,
        },
        { status: 409 }
      );
    }

    const fs =
      await import(
        "fs/promises"
      );

    const path =
      await import("path");

    const uploadDir =
      path.join(
        process.cwd(),
        "uploads",
        videoId
      );

    await fs.mkdir(
      uploadDir,
      {
        recursive: true,
      }
    );

    const chunkPath =
      path.join(
        uploadDir,
        `chunk-${chunkIndex}`
      );

    const buffer =
      Buffer.from(
        await chunk.arrayBuffer()
      );

    await fs.writeFile(
      chunkPath,
      buffer
    );

    return NextResponse.json({
      success: true,
      videoId,
      chunkIndex,
      storageMode: "local",
    });
  } catch (error) {
    console.error(
      "Upload chunk error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload chunk",
      },
      { status: 500 }
    );
  }
}