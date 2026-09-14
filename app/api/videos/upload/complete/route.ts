import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";

import {
  getOriginalObjectKey,
  getStorageMode,
  type StorageMode,
} from "@/lib/r2";

import {
  verifyCompletionProof,
} from "@/lib/upload-capability";

export async function POST(
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

    const body =
      await request.json();

    const videoId =
      String(
        body.videoId || ""
      );

    const fileName =
      String(
        body.fileName || ""
      );

    const totalChunks =
      Number(
        body.totalChunks
      );

    if (
      !videoId ||
      !fileName ||
      !Number.isInteger(
        totalChunks
      ) ||
      totalChunks <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "videoId, fileName and a valid totalChunks value are required",
        },
        { status: 400 }
      );
    }

    /* ==========================================
       R2
    ========================================== */

    if (
      storageMode === "r2"
    ) {
      const completionProof =
        String(
          body.completionProof || ""
        );

      if (!completionProof) {
        return NextResponse.json(
          {
            error:
              "R2 completion proof is required",
          },
          { status: 400 }
        );
      }

      const video =
        await prisma.video.findUnique({
          where: {
            id: videoId,
          },
          select: {
            id: true,
            status: true,
            originalFile: true,
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
              `Video is not awaiting upload completion (${video.status})`,
          },
          { status: 409 }
        );
      }

      let proof;

      try {
        proof =
          verifyCompletionProof(
            completionProof
          );
      } catch (error) {
        console.error(
          "Invalid R2 completion proof:",
          error
        );

        return NextResponse.json(
          {
            error:
              "Invalid or expired R2 completion proof",
          },
          { status: 400 }
        );
      }

      const expectedObjectKey =
        getOriginalObjectKey(
          video.id,
          video.originalFile
        );

      if (
        proof.videoId !==
        video.id
      ) {
        return NextResponse.json(
          {
            error:
              "Completion proof video does not match",
          },
          { status: 400 }
        );
      }

      if (
        proof.objectKey !==
        expectedObjectKey
      ) {
        return NextResponse.json(
          {
            error:
              "Completion proof object does not match",
          },
          { status: 400 }
        );
      }

      if (
        !Number.isFinite(
          proof.size
        ) ||
        proof.size <= 0
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid uploaded object size",
          },
          { status: 400 }
        );
      }

      if (
        !proof.uploadId ||
        !proof.etag
      ) {
        return NextResponse.json(
          {
            error:
              "Incomplete R2 completion proof",
          },
          { status: 400 }
        );
      }

      /*
       * The browser has already completed the
       * multipart upload through the Cloudflare
       * Worker.
       *
       * Next.js intentionally does NOT call R2
       * here because the user's machine has a
       * Zscaler restriction on direct R2 access.
       */

      await prisma.video.update({
        where: {
          id: videoId,
        },
        data: {
          status:
            "PROCESSING",
        },
      });

      return NextResponse.json({
        success: true,
        videoId,
        status:
          "PROCESSING",
        storageMode,
        objectKey:
          proof.objectKey,
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

    const safeFileName =
      path.basename(
        fileName
      );

    const finalPath =
      path.join(
        uploadDir,
        safeFileName
      );

    await fs.mkdir(
      uploadDir,
      {
        recursive: true,
      }
    );

    const finalHandle =
      await fs.open(
        finalPath,
        "w"
      );

    try {
      for (
        let i = 0;
        i < totalChunks;
        i++
      ) {
        const chunkPath =
          path.join(
            uploadDir,
            `chunk-${i}`
          );

        const chunkData =
          await fs.readFile(
            chunkPath
          );

        await finalHandle.write(
          chunkData
        );

        await fs.unlink(
          chunkPath
        );
      }
    } finally {
      await finalHandle.close();
    }

    await prisma.video.update({
      where: {
        id: videoId,
      },
      data: {
        status:
          "PROCESSING",
      },
    });

    return NextResponse.json({
      success: true,
      videoId,
      status:
        "PROCESSING",
      filePath:
        finalPath,
      storageMode,
    });
  } catch (error) {
    console.error(
      "Upload completion error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to complete upload",
      },
      { status: 500 }
    );
  }
}