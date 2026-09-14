

import type { CompletedPart } from "@aws-sdk/client-s3";

export type StorageMode = "local" | "r2";

const workerUrl = process.env.R2_WORKER_URL;
const workerToken = process.env.R2_WORKER_AUTH_TOKEN;

if (!workerUrl || !workerToken) {
  throw new Error("R2 Worker environment variables are not configured");
}

export function getStorageMode(): StorageMode {
  return process.env.STORAGE_MODE === "r2" ? "r2" : "local";
}

/* --------------------------------------------------
   Object key helpers
-------------------------------------------------- */

export function sanitizeObjectFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop() || "video";

  return (
    baseName
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .replace(/^\.+/, "_")
      .slice(0, 180) || "video"
  );
}

export function getOriginalObjectKey(
  videoId: string,
  fileName: string
) {
  return `originals/${videoId}/${sanitizeObjectFileName(fileName)}`;
}

/* --------------------------------------------------
   Upload state
-------------------------------------------------- */

export function getUploadStateKey(videoId: string) {
  return `upload-state/${videoId}.json`;
}

export type UploadState = {
  videoId: string;
  fileName: string;
  fileSize: number;
  objectKey: string;
  uploadId: string;
  contentType: string;
  createdAt: string;
};

/* --------------------------------------------------
   Worker request helper
-------------------------------------------------- */

async function workerRequest(
  path: string,
  init: RequestInit = {}
) {
  const response = await fetch(
    `${workerUrl}${path}`,
    {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${workerToken}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `R2 Worker request failed (${response.status}): ${text}`
    );
  }

  return response;
}

/* --------------------------------------------------
   Upload state
-------------------------------------------------- */

export async function saveUploadState(
  state: UploadState
) {
  const key = encodeURIComponent(
    getUploadStateKey(state.videoId)
  );

  await workerRequest(
    `/object?action=put&key=${key}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    }
  );
}

export async function getUploadState(
  videoId: string
): Promise<UploadState> {
  const key = encodeURIComponent(
    getUploadStateKey(videoId)
  );

  const response = await workerRequest(
    `/object?action=get&key=${key}`,
    {
      method: "GET",
    }
  );

  return (await response.json()) as UploadState;
}

export async function deleteUploadState(
  videoId: string
) {
  const key = encodeURIComponent(
    getUploadStateKey(videoId)
  );

  await workerRequest(
    `/object?action=delete&key=${key}`,
    {
      method: "DELETE",
    }
  );
}

/* --------------------------------------------------
   Multipart upload
-------------------------------------------------- */

export async function createMultipartUpload(
  objectKey: string,
  contentType: string
) {
  const key = encodeURIComponent(objectKey);
  const type = encodeURIComponent(contentType);

  const response = await workerRequest(
    `/multipart?action=create&key=${key}&contentType=${type}`,
    {
      method: "POST",
    }
  );

  return (await response.json()) as {
    success: boolean;
    uploadId: string;
    objectKey: string;
  };
}

/* --------------------------------------------------
   Upload a multipart part through Worker
-------------------------------------------------- */

export async function uploadMultipartPart(
  objectKey: string,
  uploadId: string,
  partNumber: number,
  body: BodyInit
) {
  if (
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > 10000
  ) {
    throw new Error("Invalid R2 multipart part number");
  }

  const key = encodeURIComponent(objectKey);
  const id = encodeURIComponent(uploadId);

  const response = await workerRequest(
    `/multipart?action=uploadpart&key=${key}&uploadId=${id}&partNumber=${partNumber}`,
    {
      method: "PUT",
      body,
    }
  );

  return (await response.json()) as {
    success: boolean;
    partNumber: number;
    etag: string;
  };
}

/* --------------------------------------------------
   List uploaded parts
-------------------------------------------------- */

export async function listAllParts(
  objectKey: string,
  uploadId: string
): Promise<CompletedPart[]> {
  const key = encodeURIComponent(objectKey);
  const id = encodeURIComponent(uploadId);

  const response = await workerRequest(
    `/multipart?action=parts&key=${key}&uploadId=${id}`,
    {
      method: "GET",
    }
  );

  const data = (await response.json()) as {
    success: boolean;
    parts: Array<{
      partNumber: number;
      etag: string;
    }>;
  };

  return data.parts
    .map((part) => ({
      PartNumber: part.partNumber,
      ETag: part.etag,
    }))
    .sort(
      (a, b) =>
        (a.PartNumber ?? 0) -
        (b.PartNumber ?? 0)
    );
}

/* --------------------------------------------------
   Complete multipart upload
-------------------------------------------------- */

export async function completeMultipartUpload(
  objectKey: string,
  uploadId: string,
  parts: CompletedPart[]
) {
  const key = encodeURIComponent(objectKey);
  const id = encodeURIComponent(uploadId);

  const response = await workerRequest(
    `/multipart?action=complete&key=${key}&uploadId=${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parts: parts.map((part) => ({
          partNumber: part.PartNumber,
          etag: part.ETag,
        })),
      }),
    }
  );

  return await response.json();
}

/* --------------------------------------------------
   Abort multipart upload
-------------------------------------------------- */

export async function abortMultipartUpload(
  objectKey: string,
  uploadId: string
) {
  const key = encodeURIComponent(objectKey);
  const id = encodeURIComponent(uploadId);

  await workerRequest(
    `/multipart?action=abort&key=${key}&uploadId=${id}`,
    {
      method: "DELETE",
    }
  );
}

/* --------------------------------------------------
   Object verification
-------------------------------------------------- */

export async function headObject(
  objectKey: string
) {
  const key = encodeURIComponent(objectKey);

  const response = await workerRequest(
    `/object?action=head&key=${key}`,
    {
      method: "GET",
    }
  );

  return (await response.json()) as {
    exists: boolean;
    contentLength?: number;
    contentType?: string;
    etag?: string;
  };
}