import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";
import fs from "fs/promises";
import path from "path";


const STREAMS_ROOT = path.join(process.cwd(), "streams");

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  te: "Telugu",
  hi: "Hindi",
  ta: "Tamil",
  kn: "Kannada",
  ml: "Malayalam",
};

const MAX_SIZE = 10 * 1024 * 1024;

function getWorkerConfig() {
  const workerUrl = process.env.R2_WORKER_URL;
  const workerToken = process.env.R2_WORKER_AUTH_TOKEN;

  if (!workerUrl || !workerToken) {
    throw new Error("R2 Worker environment variables are not configured");
  }

  return {
    workerUrl: workerUrl.replace(/\/$/, ""),
    workerToken,
  };
}

/*
 * Upload a subtitle file to Cloudflare R2 through the
 * Streamflix R2 Worker.
 *
 * curl.exe is intentionally used instead of Node fetch()
 * because the current development PC has Zscaler TLS
 * interception that interferes with Node HTTPS requests.
 */
async function uploadSubtitleToR2(
  filePath: string,
  objectKey: string
) {
  const { workerUrl, workerToken } = getWorkerConfig();

  const url =
    `${workerUrl}/object?action=put&key=${encodeURIComponent(
      objectKey
    )}`;

  const fileBuffer = await fs.readFile(filePath);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${workerToken}`,
      "Content-Type": "text/vtt; charset=utf-8",
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `R2 subtitle upload failed: ${response.status} ${errorText}`
    );
  }
}

/*
 * Delete a subtitle from Cloudflare R2.
 */
async function deleteSubtitleFromR2(objectKey: string) {
  const { workerUrl, workerToken } = getWorkerConfig();

  const url =
    `${workerUrl}/object?action=delete&key=${encodeURIComponent(
      objectKey
    )}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${workerToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `R2 subtitle deletion failed: ${response.status} ${errorText}`
    );
  }
}

function isSafeVideoId(id: string) {
  return (
    Boolean(id) &&
    id.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(id)
  );
}

function isSafeLanguage(language: string) {
  return /^[a-z]{2,5}$/.test(language);
}

/* --------------------------------------------------
   GET SUBTITLES
-------------------------------------------------- */

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await params;

    if (!isSafeVideoId(id)) {
      return NextResponse.json(
        { error: "Invalid video ID" },
        { status: 400 }
      );
    }

    const subtitles =
      await prisma.subtitle.findMany({
        where: {
          videoId: id,
        },
        orderBy: {
          language: "asc",
        },
        select: {
          id: true,
          language: true,
          label: true,
          filePath: true,
          updatedAt: true,
        },
      });

    return NextResponse.json(subtitles, {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error(
      "Subtitle GET error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to load subtitles",
      },
      {
        status: 500,
      }
    );
  }
}

/* --------------------------------------------------
   POST SUBTITLE
-------------------------------------------------- */

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  const admin = await requireAdminApi();

  if (admin instanceof Response) {
    return admin;
  }

  let tempFilePath: string | null = null;

  try {
    const { id } = await params;

    if (!isSafeVideoId(id)) {
      return NextResponse.json(
        { error: "Invalid video ID" },
        { status: 400 }
      );
    }

    const video =
      await prisma.video.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
        },
      });

    if (!video) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 404 }
      );
    }

    const formData =
      await request.formData();

    const languageValue =
      formData.get("language");

    const fileValue =
      formData.get("file");

    const language =
      typeof languageValue === "string"
        ? languageValue.trim().toLowerCase()
        : "";

    if (!isSafeLanguage(language)) {
      return NextResponse.json(
        { error: "Invalid language code" },
        { status: 400 }
      );
    }

    if (!(fileValue instanceof File)) {
      return NextResponse.json(
        {
          error:
            "Subtitle file is required",
        },
        { status: 400 }
      );
    }

    if (
      !fileValue.name
        .toLowerCase()
        .endsWith(".vtt")
    ) {
      return NextResponse.json(
        {
          error:
            "Only .vtt subtitle files are supported",
        },
        { status: 400 }
      );
    }

    if (fileValue.size === 0) {
      return NextResponse.json(
        {
          error:
            "Subtitle file is empty",
        },
        { status: 400 }
      );
    }

    if (fileValue.size > MAX_SIZE) {
      return NextResponse.json(
        {
          error:
            "Subtitle file is too large",
        },
        { status: 400 }
      );
    }

    const content =
      await fileValue.text();

    if (
      !content
        .trim()
        .startsWith("WEBVTT")
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid WebVTT file",
        },
        { status: 400 }
      );
    }

    /*
     * Keep a temporary local copy.
     *
     * We need this because curl.exe uploads the
     * binary/text file directly to the Worker.
     */
    const tempDir =
  process.env.STORAGE_MODE === "r2"
    ? path.join("/tmp", "streamflix", "uploads", id, "subtitles")
    : path.join(
        process.cwd(),
        "uploads",
        id,
        "subtitles"
      );

    await fs.mkdir(tempDir, {
      recursive: true,
    });

    tempFilePath = path.join(
      tempDir,
      `${language}-${Date.now()}.vtt`
    );

    await fs.writeFile(
      tempFilePath,
      content,
      "utf8"
    );

    const label =
      LANGUAGE_NAMES[language] ||
      language.toUpperCase();

    /*
     * --------------------------------------------------
     * R2 MODE
     * --------------------------------------------------
     */

    if (
      process.env.STORAGE_MODE === "r2"
    ) {
      const objectKey =
        `subtitles/${id}/${language}.vtt`;

      const filePath =
        `/media/${objectKey}`;

      /*
       * Upload first.
       *
       * Only update the database after R2
       * confirms the upload request succeeded.
       */
      await uploadSubtitleToR2(
        tempFilePath,
        objectKey
      );

      const subtitle =
        await prisma.subtitle.upsert({
          where: {
            videoId_language: {
              videoId: id,
              language,
            },
          },
          update: {
            label,
            filePath,
          },
          create: {
            videoId: id,
            language,
            label,
            filePath,
          },
        });

      return NextResponse.json(
        subtitle,
        {
          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    /*
     * --------------------------------------------------
     * LOCAL MODE
     * --------------------------------------------------
     *
     * Keep the existing local-development behavior.
     */

    const subtitlesDir =
      path.join(
        STREAMS_ROOT,
        id,
        "subtitles"
      );

    await fs.mkdir(subtitlesDir, {
      recursive: true,
    });

    const fileName =
      `${language}.vtt`;

    await fs.writeFile(
      path.join(
        subtitlesDir,
        fileName
      ),
      content,
      "utf8"
    );

    const filePath =
      `/api/stream/${id}/subtitles/${fileName}`;

    const subtitle =
      await prisma.subtitle.upsert({
        where: {
          videoId_language: {
            videoId: id,
            language,
          },
        },
        update: {
          label,
          filePath,
        },
        create: {
          videoId: id,
          language,
          label,
          filePath,
        },
      });

    return NextResponse.json(
      subtitle,
      {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "Subtitle POST error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload subtitle",
      },
      {
        status: 500,
      }
    );
  } finally {
    /*
     * Temporary R2 upload file is no longer needed.
     */
    if (tempFilePath) {
      await fs.rm(
        tempFilePath,
        {
          force: true,
        }
      ).catch(() => {});
    }
  }
}

/* --------------------------------------------------
   DELETE SUBTITLE
-------------------------------------------------- */

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  const admin = await requireAdminApi();

  if (admin instanceof Response) {
    return admin;
  }

  try {
    const { id } = await params;

    if (!isSafeVideoId(id)) {
      return NextResponse.json(
        { error: "Invalid video ID" },
        { status: 400 }
      );
    }

    const language =
      new URL(request.url)
        .searchParams
        .get("language")
        ?.trim()
        .toLowerCase();

    if (
      !language ||
      !isSafeLanguage(language)
    ) {
      return NextResponse.json(
        {
          error:
            "Valid language is required",
        },
        { status: 400 }
      );
    }

    const subtitle =
      await prisma.subtitle.findUnique({
        where: {
          videoId_language: {
            videoId: id,
            language,
          },
        },
      });

    if (!subtitle) {
      return NextResponse.json(
        {
          error:
            "Subtitle not found",
        },
        { status: 404 }
      );
    }

    /*
     * --------------------------------------------------
     * R2 MODE
     * --------------------------------------------------
     */

    if (
      process.env.STORAGE_MODE === "r2"
    ) {
      const objectKey =
        `subtitles/${id}/${language}.vtt`;

      /*
       * Delete from R2 first.
       *
       * If R2 deletion fails, we deliberately
       * keep the DB record so the application
       * does not claim the subtitle is gone
       * when the R2 object may still exist.
       */
      await deleteSubtitleFromR2(
        objectKey
      );

      await prisma.subtitle.delete({
        where: {
          id: subtitle.id,
        },
      });

      return NextResponse.json(
        {
          success: true,
        },
        {
          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    /*
     * --------------------------------------------------
     * LOCAL MODE
     * --------------------------------------------------
     */

    await fs.rm(
      path.join(
        STREAMS_ROOT,
        id,
        "subtitles",
        `${language}.vtt`
      ),
      {
        force: true,
      }
    );

    await prisma.subtitle.delete({
      where: {
        id: subtitle.id,
      },
    });

    return NextResponse.json(
      {
        success: true,
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
      "Subtitle DELETE error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete subtitle",
      },
      {
        status: 500,
      }
    );
  }
}