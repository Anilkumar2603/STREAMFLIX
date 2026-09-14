import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const history = await prisma.watchProgress.findMany({
      where: {
        userId: user.id,
        positionSeconds: {
          gt: 0,
        },
        video: {
          status: "READY",
          published: true,
          streamPath: {
            not: null,
          },
        },
      },
      include: {
        video: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json(history);
  } catch (error) {
    console.error("Watch history GET error:", error);

    return NextResponse.json(
      { error: "Failed to load watch history" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    await prisma.watchProgress.deleteMany({
      where: {
        userId: user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Watch history DELETE error:", error);

    return NextResponse.json(
      { error: "Failed to clear watch history" },
      { status: 500 }
    );
  }
}