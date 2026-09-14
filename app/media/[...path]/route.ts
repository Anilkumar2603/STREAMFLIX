import { NextResponse } from "next/server";

const WORKER_URL = process.env.NEXT_PUBLIC_R2_WORKER_URL;

function isSafeMediaPath(pathParts: string[]) {
  if (pathParts.length === 0) {
    return false;
  }

  const allowedRoots = new Set([
    "streams",
    "subtitles",
    "thumbnails",
  ]);

  if (!allowedRoots.has(pathParts[0])) {
    return false;
  }

  return pathParts.every(
    (part) =>
      part.length > 0 &&
      part !== "." &&
      part !== ".." &&
      !part.includes("\\")
  );
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ path: string[] }>;
  }
) {
  if (!WORKER_URL) {
    return new NextResponse(
      "R2 Worker URL is not configured",
      { status: 500 }
    );
  }

  const { path } = await context.params;

  if (!isSafeMediaPath(path)) {
    return new NextResponse("Not found", {
      status: 404,
    });
  }

  const objectPath = path.join("/");

  const workerUrl =
    `${WORKER_URL.replace(/\/$/, "")}/media/${objectPath}${new URL(
      request.url
    ).search}`;

  return NextResponse.redirect(
    workerUrl,
    307
  );
}
