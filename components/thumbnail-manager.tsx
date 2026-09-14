"use client";

import {
  useEffect,
  useState,
} from "react";

type Props = {
  videoId: string;
  thumbnailPath: string | null;
  onChange: (
    thumbnailPath: string | null
  ) => void;
};

export default function ThumbnailManager({
  videoId,
  thumbnailPath,
  onChange,
}: Props) {
  const [file, setFile] =
    useState<File | null>(null);

  const [preview, setPreview] =
    useState<string | null>(null);

  const [uploading, setUploading] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const hasCustomThumbnail =
    thumbnailPath?.startsWith(
      "/api/thumbnail/"
    ) === true ||
    thumbnailPath?.startsWith(
      `/media/thumbnails/${videoId}.jpg`
    ) === true;

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }

    const objectUrl =
      URL.createObjectURL(file);

    setPreview(objectUrl);

    return () =>
      URL.revokeObjectURL(
        objectUrl
      );
  }, [file]);

  async function uploadThumbnail() {
    if (!file) {
      setMessage(
        "Select an image first."
      );
      return;
    }

    if (
      !/^image\/(jpeg|png|webp)$/.test(
        file.type
      )
    ) {
      setMessage(
        "Use a JPG, PNG, or WebP image."
      );
      return;
    }

    if (
      file.size === 0 ||
      file.size >
        10 * 1024 * 1024
    ) {
      setMessage(
        "Thumbnail must be between 1 byte and 10 MB."
      );
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const formData =
        new FormData();

      formData.append(
        "file",
        file
      );

      const response =
        await fetch(
          `/api/videos/${videoId}/thumbnail`,
          {
            method: "POST",
            body: formData,
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Failed to upload thumbnail."
        );
      }

      onChange(
        result.thumbnailPath ??
          null
      );

      setFile(null);

      setMessage(
        "Custom thumbnail uploaded successfully."
      );
    } catch (error) {
      console.error(
        "Thumbnail upload error:",
        error
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to upload thumbnail."
      );
    } finally {
      setUploading(false);
    }
  }

  async function removeCustomThumbnail() {
    if (!hasCustomThumbnail) {
      return;
    }

    if (
      !window.confirm(
        "Remove the custom thumbnail?"
      )
    ) {
      return;
    }

    setDeleting(true);
    setMessage("");

    try {
      const response =
        await fetch(
          `/api/videos/${videoId}/thumbnail`,
          {
            method: "DELETE",
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Failed to remove thumbnail."
        );
      }

      onChange(
        result.thumbnailPath ??
          null
      );

      setMessage(
        result.thumbnailPath
          ? "Custom thumbnail removed. Generated thumbnail restored."
          : "Custom thumbnail removed."
      );
    } catch (error) {
      console.error(
        "Thumbnail delete error:",
        error
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to remove thumbnail."
      );
    } finally {
      setDeleting(false);
    }
  }

  const imageSrc =
  preview ||
  (thumbnailPath?.startsWith("/media/")
    ? `/api/thumbnail/${videoId}`
    : thumbnailPath);

  return (
    <div className="mt-6 rounded-xl border border-white/5 bg-black/20 p-4">
      <div className="mb-4">
        <p className="text-xs font-medium text-gray-500">
          Thumbnail
        </p>

        <p className="mt-1 text-[11px] text-gray-700">
          Upload a custom JPG, PNG, or WebP
          thumbnail. It will replace the
          automatically generated thumbnail.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="aspect-video overflow-hidden rounded-lg border border-white/10 bg-white/5">
          {imageSrc ? (
            <img
              src={`${imageSrc}${
                imageSrc.includes("?")
                  ? "&"
                  : "?"
              }v=${encodeURIComponent(
                preview
                  ? "preview"
                  : thumbnailPath ||
                    "current"
              )}`}
              alt="Thumbnail preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-700">
              No thumbnail
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-4">
          <div>
            <label className="mb-2 block text-xs font-medium text-gray-400">
              Custom image
            </label>

            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={
                uploading ||
                deleting
              }
              onChange={(event) =>
                setFile(
                  event.target
                    .files?.[0] ||
                    null
                )
              }
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-white"
            />

            <p className="mt-2 text-[10px] text-gray-700">
              Maximum 10 MB. The image is
              normalized to a 16:9 JPG for
              consistent playback cards.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                uploading ||
                deleting ||
                !file
              }
              onClick={
                uploadThumbnail
              }
              className="rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading
                ? "Uploading..."
                : "Upload Thumbnail"}
            </button>

            {hasCustomThumbnail && (
              <button
                type="button"
                disabled={
                  uploading ||
                  deleting
                }
                onClick={
                  removeCustomThumbnail
                }
                className="rounded-lg border border-red-500/20 px-4 py-2.5 text-xs font-medium text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting
                  ? "Removing..."
                  : "Use Generated Thumbnail"}
              </button>
            )}
          </div>

          {message && (
            <p className="text-xs text-gray-500">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}