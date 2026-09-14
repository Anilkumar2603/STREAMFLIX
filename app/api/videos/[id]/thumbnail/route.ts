import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const STREAMS_ROOT = path.join(
  process.cwd(),
  "streams"
);

const UPLOADS_ROOT = path.join(
  process.cwd(),
  "uploads"
);

const MAX_SIZE =
  10 * 1024 * 1024;

const CUSTOM_THUMBNAIL_NAME =
  "thumbnail-custom.jpg";

function isSafeId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function generatedThumbnailCandidates(
  id: string
) {
  return [
    path.join(
      STREAMS_ROOT,
      id,
      "thumbnail.jpg"
    ),

    path.join(
      process.cwd(),
      "public",
      "streams",
      id,
      "thumbnail.jpg"
    ),
  ];
}

async function findGeneratedThumbnail(
  id: string
) {
  for (
    const candidate of generatedThumbnailCandidates(
      id
    )
  ) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next location.
    }
  }

  return null;
}

/* =========================================================
   R2 HELPERS
   ========================================================= */

async function uploadThumbnailToR2(
  filePath: string,
  objectKey: string
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

  const url =
    `${workerUrl}/object?action=put&key=${encodeURIComponent(
      objectKey
    )}`;

  console.log(
    `Uploading thumbnail to R2: ${objectKey}`
  );

  await execFileAsync(
    "curl.exe",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry",
      "3",
      "--retry-delay",
      "1",
      "-X",
      "PUT",
      "-H",
      `Authorization: Bearer ${workerToken}`,
      "-H",
      "Content-Type: image/jpeg",
      "--upload-file",
      filePath,
      url,
    ],
    {
      maxBuffer:
        1024 * 1024 * 5,
    }
  );

  console.log(
    `Thumbnail uploaded to R2: ${objectKey}`
  );
}

async function deleteThumbnailFromR2(
  objectKey: string
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

  const url =
    `${workerUrl}/object?action=delete&key=${encodeURIComponent(
      objectKey
    )}`;

  console.log(
    `Deleting thumbnail from R2: ${objectKey}`
  );

  await execFileAsync(
    "curl.exe",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry",
      "3",
      "--retry-delay",
      "1",
      "-X",
      "DELETE",
      "-H",
      `Authorization: Bearer ${workerToken}`,
      url,
    ],
    {
      maxBuffer:
        1024 * 1024 * 5,
    }
  );

  console.log(
    `Thumbnail deleted from R2: ${objectKey}`
  );
}

/* =========================================================
   POST
   ========================================================= */

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const admin =
    await requireAdminApi();

  if (admin instanceof Response) {
    return admin;
  }

  try {
    const { id } =
      await params;

    if (!isSafeId(id)) {
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

    const video =
      await prisma.video.findUnique(
        {
          where: {
            id,
          },

          select: {
            id: true,
          },
        }
      );

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

    const formData =
      await request.formData();

    const fileValue =
      formData.get("file");

    if (
      !(fileValue instanceof File)
    ) {
      return NextResponse.json(
        {
          error:
            "Thumbnail image is required",
        },
        {
          status: 400,
        }
      );
    }

    const allowedTypes =
      new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
      ]);

    if (
      !allowedTypes.has(
        fileValue.type
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only JPG, PNG, and WebP thumbnails are supported",
        },
        {
          status: 400,
        }
      );
    }

    if (
      fileValue.size === 0 ||
      fileValue.size > MAX_SIZE
    ) {
      return NextResponse.json(
        {
          error:
            fileValue.size === 0
              ? "Thumbnail file is empty"
              : "Thumbnail file is too large (maximum 10 MB)",
        },
        {
          status: 400,
        }
      );
    }

    const videoUploadDir =
      path.join(
        UPLOADS_ROOT,
        id
      );

    const streamDir =
      path.join(
        STREAMS_ROOT,
        id
      );

    const tempPath =
      path.join(
        videoUploadDir,
        `.thumbnail-${randomUUID()}.tmp`
      );

    const outputPath =
      path.join(
        streamDir,
        CUSTOM_THUMBNAIL_NAME
      );

    await fs.mkdir(
      videoUploadDir,
      {
        recursive: true,
      }
    );

    await fs.mkdir(
      streamDir,
      {
        recursive: true,
      }
    );

    try {
      /* =====================================================
         1. SAVE TEMPORARY UPLOAD
         ===================================================== */

      const buffer =
        Buffer.from(
          await fileValue.arrayBuffer()
        );

      await fs.writeFile(
        tempPath,
        buffer
      );

      /* =====================================================
         2. NORMALIZE WITH FFMPEG
         ===================================================== */

      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i",
          tempPath,
          "-frames:v",
          "1",
          "-vf",
          "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
          "-q:v",
          "2",
          outputPath,
        ],
        {
          maxBuffer:
            5 * 1024 * 1024,
        }
      );

      await fs.access(
        outputPath
      );

      /* =====================================================
         3. R2 MODE
         ===================================================== */

      if (
        process.env.STORAGE_MODE ===
        "r2"
      ) {
        const objectKey =
          `thumbnails/${id}.jpg`;

        await uploadThumbnailToR2(
          outputPath,
          objectKey
        );

        /*
         * Browser-facing path.
         *
         * The actual R2 object remains private.
         */
        const thumbnailPath =
          `/media/thumbnails/${id}.jpg`;

        await prisma.video.update(
          {
            where: {
              id,
            },

            data: {
              thumbnailPath,
            },
          }
        );

        return NextResponse.json(
          {
            success: true,
            thumbnailPath,
          },
          {
            headers: {
              "Cache-Control":
                "no-store, no-cache, must-revalidate",
            },
          }
        );
      }

      /* =====================================================
         4. LOCAL MODE
         ===================================================== */

      const thumbnailPath =
        `/api/thumbnail/${id}`;

      await prisma.video.update(
        {
          where: {
            id,
          },

          data: {
            thumbnailPath,
          },
        }
      );

      return NextResponse.json(
        {
          success: true,
          thumbnailPath,
        },
        {
          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate",
          },
        }
      );
    } finally {
      await fs.rm(
        tempPath,
        {
          force: true,
        }
      );
    }
  } catch (error) {
    console.error(
      "Thumbnail POST error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to upload thumbnail",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
   DELETE CUSTOM THUMBNAIL
   ========================================================= */

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const admin =
    await requireAdminApi();

  if (admin instanceof Response) {
    return admin;
  }

  try {
    const { id } =
      await params;

    if (!isSafeId(id)) {
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

    const video =
      await prisma.video.findUnique(
        {
          where: {
            id,
          },

          select: {
            id: true,
            thumbnailPath: true,
          },
        }
      );

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

    /* =====================================================
       R2 MODE
       ===================================================== */

    if (
      process.env.STORAGE_MODE ===
      "r2"
    ) {
      const objectKey =
        `thumbnails/${id}.jpg`;

      /*
       * Only delete the R2 object if the
       * current thumbnail is actually our
       * R2 custom thumbnail.
       */
      if (
        video.thumbnailPath ===
        `/media/thumbnails/${id}.jpg`
      ) {
        await deleteThumbnailFromR2(
          objectKey
        );
      }

      /*
       * The generated thumbnail was deliberately
       * NOT uploaded to R2.
       *
       * If it exists locally, use it as fallback.
       */
      const generatedPath =
        await findGeneratedThumbnail(
          id
        );

      const thumbnailPath =
        generatedPath
          ? generatedPath.startsWith(
              path.join(
                process.cwd(),
                "public"
              )
            )
            ? generatedPath
                .slice(
                  path.join(
                    process.cwd(),
                    "public"
                  ).length
                )
                .replace(
                  /\\/g,
                  "/"
                )
            : `/streams/${id}/thumbnail.jpg`
          : null;

      await prisma.video.update(
        {
          where: {
            id,
          },

          data: {
            thumbnailPath,
          },
        }
      );

      return NextResponse.json(
        {
          success: true,
          thumbnailPath,
        },
        {
          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    /* =====================================================
       LOCAL MODE
       ===================================================== */

    const customPath =
      path.join(
        STREAMS_ROOT,
        id,
        CUSTOM_THUMBNAIL_NAME
      );

    await fs.rm(
      customPath,
      {
        force: true,
      }
    );

    const generatedPath =
      await findGeneratedThumbnail(
        id
      );

    const thumbnailPath =
      generatedPath
        ? generatedPath.startsWith(
            path.join(
              process.cwd(),
              "public"
            )
          )
          ? generatedPath
              .slice(
                path.join(
                  process.cwd(),
                  "public"
                ).length
              )
              .replace(
                /\\/g,
                "/"
              )
          : `/streams/${id}/thumbnail.jpg`
        : null;

    await prisma.video.update(
      {
        where: {
          id,
        },

        data: {
          thumbnailPath,
        },
      }
    );

    return NextResponse.json(
      {
        success: true,
        thumbnailPath,
      },
      {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "Thumbnail DELETE error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to remove custom thumbnail",
      },
      {
        status: 500,
      }
    );
  }
}