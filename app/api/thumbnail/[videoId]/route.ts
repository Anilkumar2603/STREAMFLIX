import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";


const STREAMS_ROOT =
  path.join(
    process.cwd(),
    "streams"
  );

const PUBLIC_STREAMS_ROOT =
  path.join(
    process.cwd(),
    "public",
    "streams"
  );

const UPLOADS_ROOT =
  path.join(
    process.cwd(),
    "uploads"
  );

function isSafeId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/* =========================================================
   LOCAL THUMBNAIL
   ========================================================= */

async function findLocalThumbnail(
  id: string
) {
  const candidates = [
    path.join(
      STREAMS_ROOT,
      id,
      "thumbnail-custom.jpg"
    ),

    path.join(
      UPLOADS_ROOT,
      id,
      "thumbnail-custom.jpg"
    ),

    path.join(
      STREAMS_ROOT,
      id,
      "thumbnail.jpg"
    ),

    path.join(
      PUBLIC_STREAMS_ROOT,
      id,
      "thumbnail.jpg"
    ),
  ];

  for (
    const candidate of candidates
  ) {
    try {
      await fs.access(
        candidate
      );

      return candidate;
    } catch {
      // Try next location.
    }
  }

  return null;
}

/* =========================================================
   R2 THUMBNAIL
   ========================================================= */

async function getR2Thumbnail(
  videoId: string
) {
  const workerUrl =
    process.env.R2_WORKER_URL;

  const workerToken =
    process.env.R2_WORKER_AUTH_TOKEN;

  if (
    !workerUrl ||
    !workerToken
  ) {
    throw new Error(
      "R2 Worker environment variables are not configured"
    );
  }

  const objectKey =
    `thumbnails/${videoId}.jpg`;

  const url =
    `${workerUrl}/object?action=get&key=${encodeURIComponent(
      objectKey
    )}`;

  console.log(
    `Fetching thumbnail from R2: ${objectKey}`
  );

  const response =
    await fetch(url, {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${workerToken}`,
      },

      cache: "no-store",
    });

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `R2 thumbnail fetch failed: ${response.status} ${errorText}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

/* =========================================================
   GET
   ========================================================= */

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      videoId: string;
    }>;
  }
) {
  try {
    const { videoId } =
      await params;

    if (
      !isSafeId(videoId)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid video id",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * In R2 mode the custom thumbnail is stored at:
     *
     * thumbnails/<videoId>.jpg
     *
     * Try R2 first.
     */
    if (
      process.env.STORAGE_MODE ===
      "r2"
    ) {
      try {
        const file =
          await getR2Thumbnail(
            videoId
          );

        return new NextResponse(
          file,
          {
            status: 200,

            headers: {
              "Content-Type":
                "image/jpeg",

              "Cache-Control":
                "public, max-age=3600, s-maxage=3600",

              "X-Content-Type-Options":
                "nosniff",
            },
          }
        );
      } catch {
        /*
         * No custom R2 thumbnail.
         *
         * Fall back to the generated local
         * thumbnail if one exists.
         */
      }
    }

    /* =====================================================
       LOCAL / GENERATED FALLBACK
       ===================================================== */

    const thumbnailPath =
      await findLocalThumbnail(
        videoId
      );

    if (!thumbnailPath) {
      return new NextResponse(
        "Thumbnail not found",
        {
          status: 404,

          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    const file =
      await fs.readFile(
        thumbnailPath
      );

    return new NextResponse(
      file,
      {
        status: 200,

        headers: {
          "Content-Type":
            "image/jpeg",

          "Cache-Control":
            "public, max-age=3600, s-maxage=3600",

          "X-Content-Type-Options":
            "nosniff",
        },
      }
    );
  } catch (error) {
    console.error(
      "Thumbnail GET error:",
      error
    );

    return new NextResponse(
      "Failed to load thumbnail",
      {
        status: 500,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}
