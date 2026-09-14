import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");

    if (!videoId) {
      return NextResponse.json(
        { error: "videoId is required" },
        { status: 400 }
      );
    }

    const reviews = await prisma.videoReview.findMany({
      where: { videoId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const average =
      reviews.length > 0
        ? reviews.reduce((sum, item) => sum + item.rating, 0) /
          reviews.length
        : 0;

    const user = await getCurrentUser();

    const currentUserReview = user
      ? reviews.find((item) => item.userId === user.id) || null
      : null;

    return NextResponse.json({
      reviews,
      average: Number(average.toFixed(1)),
      count: reviews.length,
      currentUserReview,
    });
  } catch (error) {
    console.error("Reviews GET error:", error);

    return NextResponse.json(
      { error: "Failed to load reviews" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Please sign in to rate this video" },
        { status: 401 }
      );
    }

    const body = await request.json();

    const videoId =
      typeof body.videoId === "string" ? body.videoId.trim() : "";

    const rating = Number(body.rating);

    const review =
      typeof body.review === "string"
        ? body.review.trim().slice(0, 1000)
        : null;

    if (!videoId) {
      return NextResponse.json(
        { error: "videoId is required" },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    const video = await prisma.video.findFirst({
      where: {
        id: videoId,
        status: "READY",
        published: true,
        streamPath: {
          not: null,
        },
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

    const savedReview = await prisma.videoReview.upsert({
      where: {
        userId_videoId: {
          userId: user.id,
          videoId,
        },
      },
      update: {
        rating,
        review: review || null,
      },
      create: {
        userId: user.id,
        videoId,
        rating,
        review: review || null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json(savedReview);
  } catch (error) {
    console.error("Reviews POST error:", error);

    return NextResponse.json(
      { error: "Failed to save review" },
      { status: 500 }
    );
  }
}