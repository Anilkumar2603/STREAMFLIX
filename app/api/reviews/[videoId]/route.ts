import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { videoId } = await params;

    await prisma.videoReview.deleteMany({
      where: {
        userId: user.id,
        videoId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reviews DELETE error:", error);

    return NextResponse.json(
      { error: "Failed to delete review" },
      { status: 500 }
    );
  }
}