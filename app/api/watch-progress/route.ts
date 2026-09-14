import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/*
 * GET
 *
 * Return the current user's watch progress.
 *
 * Optional:
 * /api/watch-progress?videoId=...
 */
export async function GET(
  request: Request
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    const url = new URL(request.url);

    const videoId =
      url.searchParams.get(
        "videoId"
      );

    if (videoId) {
      const progress =
        await prisma.watchProgress.findUnique(
          {
            where: {
              userId_videoId: {
                userId: user.id,
                videoId,
              },
            },
          }
        );

      return NextResponse.json(
        progress ?? null
      );
    }

    /*
     * Return all progress records,
     * newest updated first.
     */
    const progress =
      await prisma.watchProgress.findMany({
        where: {
          userId: user.id,
        },
        include: {
          video: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

    /*
     * Only return currently available
     * viewer content.
     */
    const available =
      progress.filter(
        (item) =>
          item.video.status ===
            "READY" &&
          item.video.published ===
            true &&
          Boolean(
            item.video.streamPath
          )
      );

    return NextResponse.json(
      available
    );
  } catch (error) {
    console.error(
      "Get watch progress error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to load watch progress",
      },
      {
        status: 500,
      }
    );
  }
}

/*
 * POST
 *
 * Create/update playback progress.
 */
export async function POST(
  request: Request
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required",
        },
        {
          status: 401,
        }
      );
    }

    const body =
      await request.json();

    const videoId =
      typeof body.videoId ===
      "string"
        ? body.videoId.trim()
        : "";

    const positionSeconds =
      Number(
        body.positionSeconds
      );

    const durationSeconds =
      body.durationSeconds ===
      null ||
      body.durationSeconds ===
        undefined
        ? null
        : Number(
            body.durationSeconds
          );

    if (!videoId) {
      return NextResponse.json(
        {
          error:
            "Video ID is required",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !Number.isFinite(
        positionSeconds
      ) ||
      positionSeconds < 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid playback position",
        },
        {
          status: 400,
        }
      );
    }

    if (
      durationSeconds !==
        null &&
      (!Number.isFinite(
        durationSeconds
      ) ||
        durationSeconds <= 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid video duration",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Verify the video exists and is
     * currently playable.
     */
    const video =
      await prisma.video.findUnique({
        where: {
          id: videoId,
        },
        select: {
          id: true,
          status: true,
          published: true,
          streamPath: true,
        },
      });

    if (!video) {
      return NextResponse.json(
        {
          error:
            "Video not found",
        },
        {
          status: 404,
        }
      );
    }

    if (
      video.status !== "READY" ||
      video.published !== true ||
      !video.streamPath
    ) {
      return NextResponse.json(
        {
          error:
            "Video is not available",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Don't allow the client to save
     * a position beyond the duration.
     */
    let safePosition =
      positionSeconds;

    if (
      durationSeconds !== null
    ) {
      safePosition =
        Math.min(
          positionSeconds,
          durationSeconds
        );
    }

    /*
     * Consider the video completed
     * when the user reaches 90%.
     */
    const completed =
      durationSeconds !== null &&
      durationSeconds > 0 &&
      safePosition /
        durationSeconds >=
        0.9;

    const progress =
      await prisma.watchProgress.upsert(
        {
          where: {
            userId_videoId: {
              userId: user.id,
              videoId,
            },
          },
          update: {
            positionSeconds:
              safePosition,
            durationSeconds,
            completed,
          },
          create: {
            userId: user.id,
            videoId,
            positionSeconds:
              safePosition,
            durationSeconds,
            completed,
          },
        }
      );

    return NextResponse.json({
      success: true,
      progress,
    });
  } catch (error) {
    console.error(
      "Save watch progress error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to save watch progress",
      },
      {
        status: 500,
      }
    );
  }
}