import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";

import {
  getOriginalObjectKey,
  getStorageMode,
  type StorageMode,
} from "@/lib/r2";

import {
  createUploadCapability,
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

    const body =
      await request.json();

    const title =
      String(body.title || "").trim();

    const fileName =
      String(body.fileName || "").trim();

    const fileSize =
      Number(body.fileSize);

    const lastModified =
      Number(body.lastModified || 0);

    const contentType =
      String(
        body.contentType ||
          "application/octet-stream"
      );

    if (
      !title ||
      !fileName ||
      !Number.isFinite(fileSize) ||
      fileSize <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid upload information",
        },
        { status: 400 }
      );
    }

    const storageMode: StorageMode =
      getStorageMode();

    const existingVideoId =
      body.videoId
        ? String(body.videoId)
        : null;

    /* --------------------------------------------
       Resume existing upload
    -------------------------------------------- */

    if (existingVideoId) {
      const existingVideo =
        await prisma.video.findUnique({
          where: {
            id: existingVideoId,
          },
        });

      if (existingVideo) {
        if (
          existingVideo.status ===
          "UPLOADING"
        ) {
          /*
           * R2 uploads now use a short-lived
           * signed capability.
           *
           * The browser will use this capability
           * directly with the Cloudflare Worker.
           */

          if (
            storageMode === "r2"
          ) {
            const objectKey =
              getOriginalObjectKey(
                existingVideo.id,
                existingVideo.originalFile
              );

            const uploadToken =
              createUploadCapability({
                videoId:
                  existingVideo.id,

                objectKey,

                fileSize,

                contentType,
              });

            return NextResponse.json({
              success: true,
              resumed: true,
              videoId:
                existingVideo.id,
              status:
                existingVideo.status,
              fileName:
                existingVideo.originalFile,
              fileSize,
              lastModified,
              storageMode,
              objectKey,
              uploadToken,
            });
          }

          return NextResponse.json({
            success: true,
            resumed: true,
            videoId:
              existingVideo.id,
            status:
              existingVideo.status,
            fileName:
              existingVideo.originalFile,
            storageMode,
          });
        }

        if (
          existingVideo.status ===
          "PROCESSING"
        ) {
          return NextResponse.json({
            success: true,
            resumed: true,
            alreadyProcessing: true,
            videoId:
              existingVideo.id,
            status:
              existingVideo.status,
            storageMode,
          });
        }

        if (
          existingVideo.status ===
          "READY"
        ) {
          return NextResponse.json({
            success: true,
            resumed: true,
            alreadyComplete: true,
            videoId:
              existingVideo.id,
            status:
              existingVideo.status,
            storageMode,
          });
        }
      }
    }

    /* --------------------------------------------
       Create database record
    -------------------------------------------- */

    const video =
      await prisma.video.create({
        data: {
          title,
          originalFile:
            fileName,
          status: "UPLOADING",
        },
      });

    /* --------------------------------------------
       LOCAL MODE
    -------------------------------------------- */

    if (
      storageMode === "local"
    ) {
      return NextResponse.json({
        success: true,
        resumed: false,
        videoId:
          video.id,
        status:
          video.status,
        fileName:
          video.originalFile,
        fileSize,
        lastModified,
        storageMode,
      });
    }

    /* --------------------------------------------
       R2 MODE
    -------------------------------------------- */

    /*
     * IMPORTANT:
     *
     * We DO NOT call the Cloudflare Worker here.
     *
     * The browser will communicate directly with
     * the Worker using this signed capability.
     */

    const objectKey =
      getOriginalObjectKey(
        video.id,
        fileName
      );

    try {
      const uploadToken =
        createUploadCapability({
          videoId:
            video.id,

          objectKey,

          fileSize,

          contentType,
        });

      return NextResponse.json({
        success: true,
        resumed: false,
        videoId:
          video.id,
        status:
          video.status,
        fileName:
          video.originalFile,
        fileSize,
        lastModified,
        storageMode,
        objectKey,
        uploadToken,
      });
    } catch (error) {
      await prisma.video
        .delete({
          where: {
            id: video.id,
          },
        })
        .catch(() => {});

      throw error;
    }
  } catch (error) {
    console.error(
      "Upload start error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to start upload",
      },
      { status: 500 }
    );
  }
}