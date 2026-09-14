import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs/promises";
import path from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const title = formData.get("title") as string;
    const file = formData.get("file") as File;

    if (!title || !file) {
      return NextResponse.json(
        { error: "Title and file are required" },
        { status: 400 }
      );
    }

    const video = await prisma.video.create({
      data: {
        title,
        originalFile: file.name,
        status: "UPLOADING",
      },
    });

    const uploadDir = path.join(
      process.cwd(),
      "uploads",
      video.id
    );

    await fs.mkdir(uploadDir, { recursive: true });

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    await fs.writeFile(
      path.join(uploadDir, file.name),
      fileBuffer
    );

    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: "PROCESSING",
      },
    });

    return NextResponse.json(video, { status: 201 });
  } catch (error) {
    console.error("Upload error:", error);

    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}