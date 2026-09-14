import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorageMode } from "@/lib/r2";
type RouteContext = {
  params: Promise<{
    videoId: string;
    path: string[];
  }>;
};

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  try {
    /*
     * 1. Authentication
     */
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

    /*
     * 2. Get URL parameters
     */
    const { videoId, path: filePath } =
      await params;

    if (
      !videoId ||
      !filePath ||
      filePath.length === 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid stream path",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * 3. Check video
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
          error: "Video not found",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * 4. Video must be playable
     */
    if (
      video.status !== "READY" ||
      video.published !== true ||
      !video.streamPath
    ) {
      return NextResponse.json(
        {
          error: "Video is not available",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * 5. Prevent path traversal
     */
    const requestedPath =
      filePath.join("/");

    if (
      requestedPath.includes("..") ||
      requestedPath.includes("\\")
    ) {
      return NextResponse.json(
        {
          error: "Invalid stream path",
        },
        {
          status: 400,
        }
      );
    }
/*
 * 6. R2 production delivery
 *
 * Keep the Watch Page unchanged.
 * /api/stream/... is forwarded to the public
 * Cloudflare Worker media endpoint.
 */
if (getStorageMode() === "r2") {
  const workerUrl =
    process.env.NEXT_PUBLIC_R2_WORKER_URL;

  if (!workerUrl) {
    console.error(
      "NEXT_PUBLIC_R2_WORKER_URL is not configured"
    );

    return NextResponse.json(
      {
        error: "Streaming service is not configured",
      },
      {
        status: 500,
      }
    );
  }

  const objectPath =
    `streams/${videoId}/${requestedPath}`;

  const r2Url =
    `${workerUrl.replace(/\/$/, "")}/media/${objectPath}`;

  return NextResponse.redirect(r2Url, {
    status: 307,
  });
}
    /*
     * 6. IMPORTANT
     *
     * HLS files are now stored here:
     *
     * <project-root>/streams/<videoId>
     *
     * NOT:
     *
     * <project-root>/public/streams/<videoId>
     */
    const streamDirectory =
      path.join(
        process.cwd(),
        "streams",
        videoId
      );

    /*
     * 7. Build requested file path
     */
    const absolutePath =
      path.resolve(
        streamDirectory,
        requestedPath
      );

    const resolvedStreamDirectory =
      path.resolve(
        streamDirectory
      );

    /*
     * Make sure the requested file
     * remains inside this video's
     * stream directory.
     */
    if (
      !absolutePath.startsWith(
        resolvedStreamDirectory +
          path.sep
      )
    ) {
      return NextResponse.json(
        {
          error: "Invalid stream path",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * 8. Check file exists
     */
    if (!existsSync(absolutePath)) {
      console.error(
        "Stream file not found:",
        absolutePath
      );

      return NextResponse.json(
        {
          error: "Stream file not found",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * 9. Read file
     */
    const file =
      await readFile(absolutePath);

    /*
     * 10. Content type
     */
    const extension =
      path
        .extname(absolutePath)
        .toLowerCase();

    let contentType =
      "application/octet-stream";

    if (extension === ".m3u8") {
      contentType =
        "application/vnd.apple.mpegurl";
    } else if (
      extension === ".m4s"
    ) {
      contentType =
        "video/mp4";
    } else if (
      extension === ".mp4"
    ) {
      contentType =
        "video/mp4";
    } else if (
      extension === ".ts"
    ) 
    {
      contentType =
        "video/mp2t";
    }
    else if (
  extension === ".vtt"
) {
  contentType =
    "text/vtt; charset=utf-8";
}

    /*
     * 11. Return file
     */
    return new NextResponse(file, {
      status: 200,
      headers: {
        "Content-Type":
          contentType,

        "Cache-Control":
          "private, no-store, max-age=0",

        "X-Content-Type-Options":
          "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "Stream delivery error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to load stream",
      },
      {
        status: 500,
      }
    );
  }
}
