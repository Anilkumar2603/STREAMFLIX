import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/*
 * GET
 *
 * Return the current user's My List.
 */
export async function GET() {
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

    const myList =
      await prisma.myList.findMany({
        where: {
          userId: user.id,
        },
        include: {
          video: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    /*
     * Only return videos that are currently
     * available to viewers.
     */
    const videos = myList
      .map((item) => item.video)
      .filter(
        (video) =>
          video.status === "READY" &&
          video.published === true &&
          Boolean(video.streamPath)
      );

    return NextResponse.json(videos);
  } catch (error) {
    console.error(
      "Get My List error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to load My List",
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
 * Add a video to My List.
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

    const body = await request.json();

    const videoId =
      typeof body.videoId === "string"
        ? body.videoId.trim()
        : "";

    if (!videoId) {
      return NextResponse.json(
        {
          error: "Video ID is required",
        },
        {
          status: 400,
        }
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
          error: "Video not found",
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
            "This video is not available",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * upsert prevents duplicate entries.
     */
    const item =
      await prisma.myList.upsert({
        where: {
          userId_videoId: {
            userId: user.id,
            videoId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          videoId,
        },
      });

    return NextResponse.json({
      success: true,
      added: true,
      id: item.id,
    });
  } catch (error) {
    console.error(
      "Add My List error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to add to My List",
      },
      {
        status: 500,
      }
    );
  }
}

/*
 * DELETE
 *
 * Remove a video from My List.
 */
export async function DELETE(
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

    const body = await request.json();

    const videoId =
      typeof body.videoId === "string"
        ? body.videoId.trim()
        : "";

    if (!videoId) {
      return NextResponse.json(
        {
          error: "Video ID is required",
        },
        {
          status: 400,
        }
      );
    }

    await prisma.myList.deleteMany({
      where: {
        userId: user.id,
        videoId,
      },
    });

    return NextResponse.json({
      success: true,
      removed: true,
    });
  } catch (error) {
    console.error(
      "Remove My List error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to remove from My List",
      },
      {
        status: 500,
      }
    );
  }
}