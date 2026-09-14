export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";

/**
 * GET /api/videos
 *
 * Public users:
 *   - Only published + READY videos
 *   - Only public/catalog fields
 *
 * Admin users:
 *   - Full video library
 *   - Processing information
 *   - Unpublished videos
 */
export async function GET() {
  try {
    /*
     * Try to identify whether the current request
     * belongs to an admin.
     *
     * For normal/unauthenticated users,
     * requireAdminApi() returns a Response.
     *
     * For an authenticated admin,
     * it returns the admin user.
     */
    const admin = await requireAdminApi();

    const isAdmin = !(admin instanceof Response);

    /*
     * -------------------------------------------------------
     * ADMIN
     * -------------------------------------------------------
     *
     * Admin Dashboard needs the complete library,
     * including processing and unpublished videos.
     */
    if (isAdmin) {
      const videos = await prisma.video.findMany({
        orderBy: {
          createdAt: "desc",
        },

        select: {
          id: true,
          title: true,
          description: true,
          genre: true,
          releaseYear: true,
          ageRating: true,
          featured: true,
          published: true,

          /*
           * Internal file information.
           * Only returned to admins.
           */
          originalFile: true,
          streamPath: true,
          thumbnailPath: true,

          status: true,
          duration: true,

          /*
           * Processing information.
           * Only returned to admins.
           */
          progress: true,
          processingFps: true,
          processingSpeed: true,
          processingElapsed: true,
          processingEta: true,
          processingStage: true,
          encoderUsed: true,

          createdAt: true,
        },
      });

      return NextResponse.json(videos, {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      });
    }

    /*
     * -------------------------------------------------------
     * PUBLIC
     * -------------------------------------------------------
     *
     * Do not expose:
     *   - unpublished content
     *   - processing content
     *   - original file paths
     *   - processing information
     */
    const videos = await prisma.video.findMany({
      where: {
        published: true,
        status: "READY",
      },

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        title: true,
        description: true,
        genre: true,
        releaseYear: true,
        ageRating: true,
        featured: true,
        published: true,

        /*
         * Required by the existing platform/player.
         */
        streamPath: true,
        thumbnailPath: true,

        status: true,
        duration: true,

        createdAt: true,
      },
    });

    return NextResponse.json(videos, {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Get videos error:", error);

    return NextResponse.json(
      {
        error: "Failed to fetch videos",
      },
      {
        status: 500,
      }
    );
  }
}

/**
 * POST /api/videos
 *
 * Admin-only.
 */
export async function POST(request: Request) {
  const admin = await requireAdminApi();

  if (admin instanceof Response) {
    return admin;
  }

  try {
    const body = await request.json();

    const {
      title,
      originalFile,
    } = body;

    if (!title || !originalFile) {
      return NextResponse.json(
        {
          error:
            "title and originalFile are required",
        },
        {
          status: 400,
        }
      );
    }

    const video = await prisma.video.create({
      data: {
        title,
        originalFile,
      },
    });

    return NextResponse.json(video, {
      status: 201,
    });
  } catch (error) {
    console.error(
      "Create video error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to create video",
      },
      {
        status: 500,
      }
    );
  }
}