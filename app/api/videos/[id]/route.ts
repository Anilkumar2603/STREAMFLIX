import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/admin";
type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/*
 * GET /api/videos/[id]
 *
 * Used by:
 * - Watch page
 * - Upload processing status
 * - Admin dashboard
 */
export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(video);
  } catch (error) {
    console.error("Get video error:", error);

    return NextResponse.json(
      { error: "Failed to fetch video" },
      { status: 500 }
    );
  }
}

/*
 * PATCH /api/videos/[id]
 *
 * Admin can update:
 * - title
 * - description
 * - genre
 * - releaseYear
 * - ageRating
 * - featured
 * - published
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  const admin = await requireAdminApi();

  if (admin instanceof Response) {
    return admin;
  }

  try {
    const { id } = await params;

    const existingVideo = await prisma.video.findUnique({
      where: { id },
    });

    if (!existingVideo) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 404 }
      );
    }

    const body = await request.json();

    const {
      title,
      description,
      genre,
      releaseYear,
      ageRating,
      featured,
      published,
    } = body;

    const data: {
      title?: string;
      description?: string | null;
      genre?: string | null;
      releaseYear?: number | null;
      ageRating?: string | null;
      featured?: boolean;
      published?: boolean;
    } = {};

    if (title !== undefined) {
      if (
        typeof title !== "string" ||
        title.trim().length === 0
      ) {
        return NextResponse.json(
          { error: "Title cannot be empty" },
          { status: 400 }
        );
      }

      data.title = title.trim();
    }

    if (description !== undefined) {
      data.description =
        description === null
          ? null
          : String(description).trim() || null;
    }

    if (genre !== undefined) {
      data.genre =
        genre === null
          ? null
          : String(genre).trim() || null;
    }

    if (releaseYear !== undefined) {
      if (
        releaseYear === null ||
        releaseYear === ""
      ) {
        data.releaseYear = null;
      } else {
        const year = Number(releaseYear);

        if (
          !Number.isInteger(year) ||
          year < 1800 ||
          year > 3000
        ) {
          return NextResponse.json(
            { error: "Invalid release year" },
            { status: 400 }
          );
        }

        data.releaseYear = year;
      }
    }

    if (ageRating !== undefined) {
      data.ageRating =
        ageRating === null
          ? null
          : String(ageRating).trim() || null;
    }

    if (featured !== undefined) {
      if (typeof featured !== "boolean") {
        return NextResponse.json(
          { error: "featured must be a boolean" },
          { status: 400 }
        );
      }

      data.featured = featured;
    }

    if (published !== undefined) {
      if (typeof published !== "boolean") {
        return NextResponse.json(
          { error: "published must be a boolean" },
          { status: 400 }
        );
      }

      data.published = published;
    }

    /*
     * IMPORTANT:
     *
     * Multiple videos are allowed to be featured.
     *
     * Do NOT unset featured on any other video.
     */
    const updatedVideo = await prisma.video.update({
      where: { id },
      data,
    });

    return NextResponse.json(updatedVideo);
  } catch (error) {
    console.error("Update video error:", error);

    return NextResponse.json(
      { error: "Failed to update video" },
      { status: 500 }
    );
  }
}

/*
 * DELETE /api/videos/[id]
 *
 * Deletes:
 * - Database record
 * - Original uploaded chunks/file
 * - Generated HLS streams
 * - Generated thumbnail
 *
 * We intentionally don't allow deleting a video
 * while the worker is actively processing it.
 */
export async function DELETE(
  _request: Request,
  { params }: RouteContext
) {
    const admin = await requireAdminApi();

  if (admin instanceof Response) {
    return admin;
  }
  try {
    const { id } = await params;

    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 404 }
      );
    }

    /*
     * Don't race the worker.
     *
     * The worker may currently be writing HLS
     * files for this video.
     */
    if (video.status === "PROCESSING") {
      return NextResponse.json(
        {
          error:
            "This video is currently processing. Wait until processing finishes before deleting it.",
        },
        { status: 409 }
      );
    }

    /*
     * Remove uploaded source/chunks.
     */
    const uploadDirectory = path.join(
      process.cwd(),
      "uploads",
      id
    );

    /*
     * Remove generated HLS + thumbnail.
     */
    const streamDirectory = path.join(
      process.cwd(),
      "public",
      "streams",
      id
    );

    if (existsSync(uploadDirectory)) {
      await rm(uploadDirectory, {
        recursive: true,
        force: true,
      });
    }

    if (existsSync(streamDirectory)) {
      await rm(streamDirectory, {
        recursive: true,
        force: true,
      });
    }

    /*
     * Finally remove database record.
     */
    await prisma.video.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      id,
    });
  } catch (error) {
    console.error("Delete video error:", error);

    return NextResponse.json(
      { error: "Failed to delete video" },
      { status: 500 }
    );
  }
}