"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SubtitleManager from "@/components/subtitle-manager";
import ThumbnailManager from "@/components/thumbnail-manager";

type Video = {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  releaseYear: number | null;
  ageRating: string | null;
  featured: boolean;
  published: boolean;

  status: string;
  duration: number | null;

  progress: number;
  processingFps: number | null;
  processingSpeed: number | null;
  processingElapsed: number | null;
  processingEta: number | null;
  processingStage: string | null;
  encoderUsed: string | null;

  thumbnailPath: string | null;
  createdAt: string;
};

function formatTime(seconds: number | null) {
  if (
    seconds === null ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "--:--";
  }

  const total = Math.round(seconds);

  const hours = Math.floor(total / 3600);

  const minutes = Math.floor(
    (total % 3600) / 60
  );

  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(
    2,
    "0"
  )}`;
}

function getStatusClass(status: string) {
  switch (status) {
    case "READY":
      return "bg-green-500/10 text-green-400";

    case "PROCESSING":
      return "bg-yellow-500/10 text-yellow-400";

    case "FAILED":
      return "bg-red-500/10 text-red-400";

    case "UPLOADING":
      return "bg-blue-500/10 text-blue-400";

    default:
      return "bg-white/10 text-gray-400";
  }
}

function getProcessingStageLabel(
  stage: string | null
) {
  switch (stage) {
    case "TRANSCODING":
      return "Transcoding";

    case "TRANSCODING_COMPLETE":
      return "Transcoding complete";

    case "GENERATING_THUMBNAIL":
      return "Generating thumbnail";

    case "UPLOADING_TO_R2":
      return "Uploading HLS to R2";

    case "READY":
      return "Ready";

    case "FAILED":
      return "Failed";

    default:
      return "Preparing";
  }
}

export default function AdminHomepage() {
  const [videos, setVideos] = useState<Video[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [selectedVideo, setSelectedVideo] =
    useState<Video | null>(null);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");
    const [deleting, setDeleting] =
  useState(false);

  /*
   * Load videos.
   *
   * IMPORTANT:
   * This function is defined inside the effect
   * so React does not complain about calling
   * state setters synchronously from the effect.
   */
  useEffect(() => {
    let cancelled = false;

    async function fetchVideos() {
      try {
        const response = await fetch(
          "/api/videos",
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(
            "Failed to load videos"
          );
        }

        const data =
          await response.json();

        if (
          !cancelled &&
          Array.isArray(data)
        ) {
          setVideos(data);
        }
      } catch (error) {
        console.error(
          "Admin video loading error:",
          error
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    /*
     * Delay the initial fetch by one event-loop
     * cycle so there is no synchronous state update
     * directly inside the effect body.
     */
    const initialLoad =
      window.setTimeout(() => {
        if (!cancelled) {
          void fetchVideos();
        }
      }, 0);

    /*
     * Refresh every 3 seconds.
     *
     * This gives the admin live processing
     * percentage / ETA / speed information.
     */
    const interval =
      window.setInterval(() => {
        if (!cancelled) {
          void fetchVideos();
        }
      }, 3000);

    return () => {
      cancelled = true;

      window.clearTimeout(
        initialLoad
      );

      window.clearInterval(
        interval
      );
    };
  }, []);

  /*
   * Dashboard statistics.
   */
  const stats = useMemo(() => {
    return {
      total: videos.length,

      ready: videos.filter(
        (video) =>
          video.status === "READY"
      ).length,

      processing: videos.filter(
        (video) =>
          video.status ===
          "PROCESSING"
      ).length,

      failed: videos.filter(
        (video) =>
          video.status === "FAILED"
      ).length,

      uploading: videos.filter(
        (video) =>
          video.status ===
          "UPLOADING"
      ).length,
    };
  }, [videos]);

  /*
   * Update video metadata.
   */
  async function updateVideo(
    videoId: string,
    data: Partial<Video>
  ) {
    setSaving(true);
    setMessage("");

    try {
      const response =
        await fetch(
          `/api/videos/${videoId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(
              data
            ),
          }
        );

      if (!response.ok) {
  const responseText = await response.text();

  let errorMessage = `Failed to update video (${response.status})`;

  if (responseText) {
    try {
      const result = JSON.parse(responseText);

      if (result?.error) {
        errorMessage = result.error;
      }
    } catch {
      // Response wasn't JSON.
      // Keep the HTTP status based error message.
    }
  }

  throw new Error(errorMessage);
}


      const updatedVideo =
        await response.json();

      setVideos((current) =>
        current.map((video) =>
          video.id === videoId
            ? {
                ...video,
                ...updatedVideo,
              }
            : video
        )
      );

      setSelectedVideo(
        (current) =>
          current &&
          current.id === videoId
            ? {
                ...current,
                ...updatedVideo,
              }
            : current
      );

      setMessage(
        "Changes saved successfully."
      );
    } catch (error) {
      console.error(
        "Update video error:",
        error
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to save changes."
      );
    } finally {
      setSaving(false);
    }
  }
async function deleteVideo(videoId: string) {
  const video = videos.find(
    (item) => item.id === videoId
  );

  if (!video) {
    return;
  }

  const confirmed = window.confirm(
    `Delete "${video.title}"?\n\n` +
      "This will permanently delete the video, " +
      "uploaded files, HLS streams, and thumbnail."
  );

  if (!confirmed) {
    return;
  }

  setDeleting(true);
  setMessage("");

  try {
    const response = await fetch(
      `/api/videos/${videoId}`,
      {
        method: "DELETE",
      }
    );

    /*
     * Read the response as text first.
     *
     * This prevents:
     * "Unexpected end of JSON input"
     * when the server returns an empty/non-JSON response.
     */
    const responseText =
      await response.text();

    let result: {
      success?: boolean;
      error?: string;
    } = {};

    if (responseText) {
      try {
        result = JSON.parse(responseText);
      } catch {
        // Response was not JSON.
      }
    }

    if (!response.ok) {
      throw new Error(
        result.error ??
          `Failed to delete video (${response.status})`
      );
    }

    /*
     * Remove the deleted video immediately
     * from the current dashboard.
     */
    setVideos((current) =>
      current.filter(
        (item) => item.id !== videoId
      )
    );

    /*
     * Close the edit modal if this video
     * was currently selected.
     */
    setSelectedVideo(null);

    setMessage(
      `"${video.title}" deleted successfully.`
    );
  } catch (error) {
    console.error(
      "Delete video error:",
      error
    );

    setMessage(
      error instanceof Error
        ? error.message
        : "Failed to delete video."
    );
  } finally {
    setDeleting(false);
  }
}
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* =====================================================
          HEADER
      ====================================================== */}
      <header className="border-b border-white/10 bg-[#101010]">
        <div className="flex h-16 items-center justify-between px-6 md:px-10">
          <div className="flex items-center gap-8">
            <Link
              href="/admin/homepage"
              className="text-xl font-black tracking-tight"
            >
              STREAMFLIX
            </Link>

            <span className="hidden text-sm text-gray-500 md:block">
              Admin Dashboard
            </span>
          </div>

          <div className="flex items-center gap-5">
            <Link
              href="/admin/upload"
              className="text-sm text-gray-400 transition hover:text-white"
            >
              Upload Video
            </Link>

            <Link
              href="/"
              className="text-sm text-gray-400 transition hover:text-white"
            >
              View Platform →
            </Link>
          </div>
        </div>
      </header>

      {/* =====================================================
          MAIN
      ====================================================== */}
      <div className="mx-auto max-w-[1500px] px-6 py-8 md:px-10">
        {/* Page heading */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gray-600">
            Platform Management
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Dashboard
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            Monitor processing and manage your
            streaming content.
          </p>
        </div>

        {/* =================================================
            STATISTICS
        ================================================== */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Total */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
              Total Videos
            </p>

            <p className="mt-3 text-3xl font-bold">
              {stats.total}
            </p>

            <p className="mt-1 text-xs text-gray-600">
              Content in library
            </p>
          </div>

          {/* Ready */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
              Ready
            </p>

            <p className="mt-3 text-3xl font-bold text-green-400">
              {stats.ready}
            </p>

            <p className="mt-1 text-xs text-gray-600">
              Available to viewers
            </p>
          </div>

          {/* Processing */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
              Processing
            </p>

            <p className="mt-3 text-3xl font-bold text-yellow-400">
              {stats.processing}
            </p>

            <p className="mt-1 text-xs text-gray-600">
              Currently processing or uploading
            </p>
          </div>

          {/* Failed */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
              Failed
            </p>

            <p className="mt-3 text-3xl font-bold text-red-400">
              {stats.failed}
            </p>

            <p className="mt-1 text-xs text-gray-600">
              Require attention
            </p>
          </div>
        </section>

        {/* =================================================
            PROCESSING QUEUE
        ================================================== */}
        {videos.some(
          (video) =>
            video.status ===
            "PROCESSING"
        ) && (
          <section className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  Processing Queue
                </h2>

                <p className="mt-1 text-xs text-gray-600">
                  Live processing & upload status
                </p>
              </div>

              <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-xs text-yellow-400">
                {stats.processing} active
              </span>
            </div>

            <div className="space-y-3">
              {videos
                .filter(
                  (video) =>
                    video.status ===
                    "PROCESSING"
                )
                .map((video) => {
                  const progress =
                    Math.min(
                      100,
                      Math.max(
                        0,
                        video.progress ??
                          0
                      )
                    );

                  return (
                    <div
                      key={video.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
                    >
                      {/* Top */}
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">
                            {video.title}
                          </h3>

                          <p className="mt-1 text-xs text-gray-600">
                            {getProcessingStageLabel(
                              video.processingStage
                            )}
                          </p>
                        </div>

                        {/* Metrics */}
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                          {video.processingStage ===
                          "UPLOADING_TO_R2" ? (
                            <div>
                              <span className="text-gray-600">
                                Upload{" "}
                              </span>

                              <span className="text-gray-400">
                                HLS streams → R2
                              </span>
                            </div>
                          ) : (
                            <>
                              <div>
                                <span className="text-gray-600">
                                  Encoder{" "}
                                </span>

                                <span className="text-gray-400">
                                  {video.encoderUsed ??
                                    "Detecting..."}
                                </span>
                              </div>

                              <div>
                                <span className="text-gray-600">
                                  Speed{" "}
                                </span>

                                <span className="text-gray-400">
                                  {video.processingSpeed !==
                                    null &&
                                  Number.isFinite(
                                    video.processingSpeed
                                  )
                                    ? `${video.processingSpeed.toFixed(
                                        1
                                      )}x`
                                    : "--"}
                                </span>
                              </div>
                            </>
                          )}

                          <div>
                            <span className="text-gray-600">
                              ETA{" "}
                            </span>

                            <span className="text-gray-400">
                              {formatTime(
                                video.processingEta
                              )}
                            </span>
                          </div>

                          <span className="text-base font-bold text-white">
                            {Math.round(
                              progress
                            )}
                            %
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-white transition-all duration-700"
                          style={{
                            width: `${progress}%`,
                          }}
                        />
                      </div>

                      {/* Bottom metrics */}
                      <div className="mt-2 flex items-center justify-between text-[11px] text-gray-600">
                        <span>
                          Elapsed{" "}
                          {formatTime(
                            video.processingElapsed
                          )}
                        </span>

                        {video.processingStage ===
                        "UPLOADING_TO_R2" ? (
                          <span>
                            Uploading HLS streams to R2
                          </span>
                        ) : (
                          <span>
                            FPS{" "}
                            {video.processingFps !==
                              null &&
                            Number.isFinite(
                              video.processingFps
                            )
                              ? video.processingFps.toFixed(
                                  1
                                )
                              : "--"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* =================================================
            CONTENT LIBRARY
        ================================================== */}
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Content Library
              </h2>

              <p className="mt-1 text-xs text-gray-600">
                Manage titles and publishing settings.
              </p>
            </div>

            <span className="text-xs text-gray-600">
              {videos.length} videos
            </span>
          </div>

          {loading ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] py-20 text-center text-sm text-gray-500">
              Loading content...
            </div>
          ) : videos.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] py-20 text-center">
              <p className="text-sm text-gray-400">
                No videos found.
              </p>

              <Link
                href="/admin/upload"
                className="mt-4 inline-block rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                Upload Video
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/10">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[950px] text-left">
                  <thead className="bg-white/[0.03]">
                    <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.15em] text-gray-600">
                      <th className="px-5 py-4">
                        Content
                      </th>

                      <th className="px-5 py-4">
                        Status
                      </th>

                      <th className="px-5 py-4">
                        Genre
                      </th>

                      <th className="px-5 py-4">
                        Published
                      </th>

                      <th className="px-5 py-4">
                        Featured
                      </th>

                      <th className="px-5 py-4">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {videos.map(
                      (video) => (
                        <tr
                          key={video.id}
                          className="border-b border-white/5 last:border-0 transition hover:bg-white/[0.02]"
                        >
                          {/* Content */}
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-white/5">
                                {video.thumbnailPath ? (
                                  <img
                                    src={
                                      video.thumbnailPath
                                    }
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-xs text-gray-700">
                                    —
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0">
                                <p className="max-w-[280px] truncate text-sm font-medium">
                                  {
                                    video.title
                                  }
                                </p>

                                <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                                  <span>
                                    {video.releaseYear ??
                                      "Year not set"}
                                  </span>

                                  {video.ageRating && (
                                    <>
                                      <span>
                                        •
                                      </span>

                                      <span>
                                        {
                                          video.ageRating
                                        }
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Status */}
                          <td className="px-5 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getStatusClass(
                                video.status
                              )}`}
                            >
                              {
                                video.status
                              }
                            </span>
                          </td>

                          {/* Genre */}
                          <td className="px-5 py-4 text-sm text-gray-400">
                            {video.genre ??
                              "—"}
                          </td>

                          {/* Published */}
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              disabled={
                                video.status !==
                                "READY"
                              }
                              onClick={() =>
                                updateVideo(
                                  video.id,
                                  {
                                    published:
                                      !video.published,
                                  }
                                )
                              }
                              className={`rounded-full px-3 py-1 text-xs transition ${
                                video.status !==
                                "READY"
                                  ? "cursor-not-allowed bg-white/5 text-gray-700"
                                  : video.published
                                  ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                                  : "bg-white/10 text-gray-500 hover:bg-white/15"
                              }`}
                            >
                              {video.published
                                ? "Published"
                                : "Hidden"}
                            </button>
                          </td>

                          {/* Featured */}
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              disabled={
                                video.status !==
                                "READY"
                              }
                              onClick={() =>
                                updateVideo(
                                  video.id,
                                  {
                                    featured:
                                      !video.featured,
                                  }
                                )
                              }
                              className={`rounded-full px-3 py-1 text-xs transition ${
                                video.status !==
                                "READY"
                                  ? "cursor-not-allowed bg-white/5 text-gray-700"
                                  : video.featured
                                  ? "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
                                  : "bg-white/10 text-gray-500 hover:bg-white/15"
                              }`}
                            >
                              {video.featured
                                ? "Featured"
                                : "Normal"}
                            </button>
                          </td>

                          {/* Action */}
                          <td className="px-5 py-4">
  <div className="flex items-center gap-2">
    {/* Edit */}
    <button
      type="button"
      onClick={() =>
        setSelectedVideo(video)
      }
      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
    >
      Edit
    </button>

    {/* Delete */}
    <button
      type="button"
      disabled={
        deleting ||
        video.status === "PROCESSING"
      }
      onClick={() =>
        deleteVideo(video.id)
      }
      title={
        video.status === "PROCESSING"
          ? "Cannot delete while processing"
          : "Delete content"
      }
      className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/5 disabled:text-gray-700"
    >
      {video.status === "PROCESSING"
        ? "Processing"
        : "Delete"}
    </button>
  </div>
</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* =====================================================
          EDIT MODAL
      ====================================================== */}
      {selectedVideo && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm md:items-center md:p-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[#151515] p-6 shadow-2xl md:rounded-2xl">
            {/* Modal header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-600">
                  Content Management
                </p>

                <h2 className="mt-2 text-xl font-semibold">
                  Edit Content
                </h2>

                <p className="mt-1 text-xs text-gray-500">
                  Update metadata and visibility.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedVideo(
                    null
                  );
                  setMessage("");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-lg text-gray-500 transition hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </div>

            {/* Title */}
            <label className="mt-7 block">
              <span className="mb-2 block text-xs font-medium text-gray-400">
                Title
              </span>

              <input
                value={
                  selectedVideo.title
                }
                onChange={(event) =>
                  setSelectedVideo({
                    ...selectedVideo,
                    title:
                      event.target.value,
                  })
                }
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-gray-700 focus:border-white/30"
              />
            </label>

            {/* Description */}
            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-medium text-gray-400">
                Description
              </span>

              <textarea
                value={
                  selectedVideo.description ??
                  ""
                }
                onChange={(event) =>
                  setSelectedVideo({
                    ...selectedVideo,
                    description:
                      event.target
                        .value,
                  })
                }
                rows={4}
                placeholder="Enter a description..."
                className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-gray-700 focus:border-white/30"
              />
            </label>

            {/* Metadata */}
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {/* Genre */}
              <label>
                <span className="mb-2 block text-xs font-medium text-gray-400">
                  Genre
                </span>

                <input
                  value={
                    selectedVideo.genre ??
                    ""
                  }
                  onChange={(event) =>
                    setSelectedVideo({
                      ...selectedVideo,
                      genre:
                        event.target
                          .value,
                    })
                  }
                  placeholder="Action"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-700 focus:border-white/30"
                />
              </label>

              {/* Year */}
              <label>
                <span className="mb-2 block text-xs font-medium text-gray-400">
                  Release Year
                </span>

                <input
                  type="number"
                  value={
                    selectedVideo.releaseYear ??
                    ""
                  }
                  onChange={(event) =>
                    setSelectedVideo({
                      ...selectedVideo,
                      releaseYear:
                        event.target
                          .value
                          ? Number(
                              event.target
                                .value
                            )
                          : null,
                    })
                  }
                  placeholder="2026"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-700 focus:border-white/30"
                />
              </label>

              {/* Rating */}
              <label>
                <span className="mb-2 block text-xs font-medium text-gray-400">
                  Age Rating
                </span>

                <input
                  value={
                    selectedVideo.ageRating ??
                    ""
                  }
                  onChange={(event) =>
                    setSelectedVideo({
                      ...selectedVideo,
                      ageRating:
                        event.target
                          .value,
                    })
                  }
                  placeholder="U/A 13+"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-700 focus:border-white/30"
                />
              </label>
            </div>

            {/* Status information */}
            <div className="mt-6 rounded-xl border border-white/5 bg-black/20 p-4">
              <p className="mb-3 text-xs font-medium text-gray-500">
                Processing Information
              </p>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-700">
                    Status
                  </p>

                  <p className="mt-1 text-xs text-gray-300">
                    {selectedVideo.status}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-700">
                    Progress
                  </p>

                  <p className="mt-1 text-xs text-gray-300">
                    {Math.round(
                      selectedVideo.progress ??
                        0
                    )}
                    %
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-700">
                    Encoder
                  </p>

                  <p className="mt-1 truncate text-xs text-gray-300">
                    {selectedVideo.encoderUsed ??
                      "—"}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-700">
                    Duration
                  </p>

                  <p className="mt-1 text-xs text-gray-300">
                    {formatTime(
                      selectedVideo.duration
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Thumbnail */}
            <ThumbnailManager
              videoId={selectedVideo.id}
              thumbnailPath={selectedVideo.thumbnailPath}
              onChange={(thumbnailPath) => {
                setSelectedVideo((current) =>
                  current
                    ? { ...current, thumbnailPath }
                    : current
                );

                setVideos((current) =>
                  current.map((video) =>
                    video.id === selectedVideo.id
                      ? { ...video, thumbnailPath }
                      : video
                  )
                );
              }}
            />

            {/* Subtitles */}
            <SubtitleManager videoId={selectedVideo.id} />

            {/* Publishing */}
            <div className="mt-6 space-y-3">
              {/* Published */}
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4 transition hover:bg-white/[0.03]">
                <div>
                  <p className="text-sm font-medium">
                    Published
                  </p>

                  <p className="mt-1 text-xs text-gray-600">
                    Make this content visible
                    to viewers.
                  </p>
                </div>

                <input
                  type="checkbox"
                  checked={
                    selectedVideo.published
                  }
                  onChange={(event) =>
                    setSelectedVideo({
                      ...selectedVideo,
                      published:
                        event.target.checked,
                    })
                  }
                  className="h-5 w-5 accent-white"
                />
              </label>

              {/* Featured */}
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4 transition hover:bg-white/[0.03]">
                <div>
                  <p className="text-sm font-medium">
                    Featured
                  </p>

                  <p className="mt-1 text-xs text-gray-600">
                    Use this title as featured
                    content on the homepage.
                  </p>
                </div>

                <input
                  type="checkbox"
                  checked={
                    selectedVideo.featured
                  }
                  onChange={(event) =>
                    setSelectedVideo({
                      ...selectedVideo,
                      featured:
                        event.target.checked,
                    })
                  }
                  className="h-5 w-5 accent-white"
                />
              </label>
            </div>

            {/* Footer */}
            <div className="mt-7 flex flex-col gap-3 border-t border-white/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-gray-500">
                {message}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedVideo(
                      null
                    );
                    setMessage("");
                  }}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-gray-400 transition hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    updateVideo(
                      selectedVideo.id,
                      {
                        title:
                          selectedVideo.title,
                        description:
                          selectedVideo.description,
                        genre:
                          selectedVideo.genre,
                        releaseYear:
                          selectedVideo.releaseYear,
                        ageRating:
                          selectedVideo.ageRating,
                        published:
                          selectedVideo.published,
                        featured:
                          selectedVideo.featured,
                      }
                    )
                  }
                  className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
