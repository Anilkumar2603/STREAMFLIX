"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Video = {
  id: string;
  title: string;
  thumbnailPath: string | null;
  duration: number | null;
  genre: string | null;
  releaseYear: number | null;
  ageRating: string | null;
};

type WatchProgress = {
  id: string;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  updatedAt: string;
  video: Video;
};

function formatDuration(seconds: number | null) {
  if (
    seconds === null ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "";
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatGenres(genre: string | null) {
  if (!genre) return "";

  return genre
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" • ");
}

export default function ContinueWatchingRow() {
  const [items, setItems] = useState<WatchProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadContinueWatching() {
      try {
        const response = await fetch("/api/watch-progress", {
          cache: "no-store",
        });

        if (!response.ok) {
          setItems([]);
          return;
        }

        const data = await response.json();

        const progressItems = Array.isArray(data)
          ? data
          : data.progress || [];

        setItems(
          progressItems
            .filter(
              (item: WatchProgress) =>
                item.video &&
                !item.completed &&
                item.positionSeconds > 0
            )
            .slice(0, 10)
        );
      } catch (error) {
        console.error(
          "Failed to load Continue Watching:",
          error
        );
        setItems([]);
      } finally {
        setLoading(false);
      }
    }

    // Initial load
    loadContinueWatching();

    // Reload when watch progress changes.
    const handleProgressUpdate = () => {
      loadContinueWatching();
    };

    // Reload when the page becomes active again.
    const handleFocus = () => {
      loadContinueWatching();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadContinueWatching();
      }
    };

    window.addEventListener(
      "watch-progress-updated",
      handleProgressUpdate
    );

    window.addEventListener("focus", handleFocus);

    document.addEventListener(
      "visibilitychange",
      handleVisibility
    );

    return () => {
      window.removeEventListener(
        "watch-progress-updated",
        handleProgressUpdate
      );

      window.removeEventListener("focus", handleFocus);

      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };
  }, []);

  if (loading || items.length === 0) {
    return null;
  }

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between px-4 md:px-8">
        <h2 className="text-xl font-semibold text-white md:text-2xl">
          Continue Watching
        </h2>
      </div>

      <div className="flex gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide md:px-8">
        {items.map((item) => {
          const video = item.video;

          const duration =
            item.durationSeconds || video.duration || 0;

          const progressPercent =
            duration > 0
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    (item.positionSeconds / duration) * 100
                  )
                )
              : 0;

          const metadata = [
            video.releaseYear ? String(video.releaseYear) : "",
            video.ageRating || "",
            formatGenres(video.genre),
          ].filter(Boolean);

          return (
            <Link
              key={item.id}
              href={`/watch/${video.id}`}
              className="group relative min-w-[220px] max-w-[220px] shrink-0 md:min-w-[260px] md:max-w-[260px]"
            >
              <div className="relative aspect-video overflow-hidden rounded-md bg-[#181818] shadow-lg transition duration-300 group-hover:z-20 group-hover:scale-105 group-hover:shadow-2xl">
                {video.thumbnailPath ? (
                  <img
                    src={video.thumbnailPath}
                    alt={video.title}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-800 to-black">
                    <span className="text-3xl text-white/20">
                      ▶
                    </span>
                  </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />

                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover:opacity-100">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-lg text-black shadow-xl">
                    ▶
                  </div>
                </div>

                {video.duration !== null && (
                  <div className="absolute bottom-3 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    {formatDuration(video.duration)}
                  </div>
                )}

                {/* Watch progress */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                  <div
                    className="h-full bg-red-600"
                    style={{
                      width: `${progressPercent}%`,
                    }}
                  />
                </div>
              </div>

              <div className="mt-2">
                <h3 className="truncate text-sm font-medium text-white">
                  {video.title}
                </h3>

                {metadata.length > 0 && (
                  <p className="mt-1 truncate text-xs text-gray-400">
                    {metadata.join(" • ")}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}