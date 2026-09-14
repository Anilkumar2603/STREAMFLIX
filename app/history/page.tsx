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

type HistoryItem = {
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

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    async function loadHistory() {
      try {
        const response = await fetch("/api/watch-history", {
          cache: "no-store",
        });

        if (!response.ok) {
          setHistory([]);
          return;
        }

        const data = await response.json();
        setHistory(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Failed to load watch history:", error);
        setHistory([]);
      } finally {
        setLoading(false);
      }
    }

    loadHistory();
  }, []);

  async function clearHistory() {
    const confirmed = window.confirm(
      "Are you sure you want to clear your watch history?"
    );

    if (!confirmed) return;

    try {
      setClearing(true);

      const response = await fetch("/api/watch-history", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to clear history");
      }

      setHistory([]);
    } catch (error) {
      console.error(error);
      alert("Failed to clear watch history.");
    } finally {
      setClearing(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#141414] px-5 pt-24 text-white md:px-10">
        <div className="mx-auto max-w-[1800px]">
          <div className="h-8 w-52 animate-pulse rounded bg-white/10" />
          <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-white/5" />

          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index}>
                <div className="aspect-video animate-pulse rounded-lg bg-white/10" />
                <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#141414] text-white">
      {/* Navbar */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#141414]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between px-5 md:px-10">
          <Link
            href="/"
            className="text-xl font-black tracking-tight text-white transition hover:text-white/80 md:text-2xl"
          >
            STREAMFLIX
          </Link>

          <Link
            href="/"
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            ← Browse
          </Link>
        </div>
      </header>

      {/* Header */}
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.045] via-transparent to-black/40" />

        <div className="relative mx-auto max-w-[1800px] px-5 pb-10 pt-10 md:px-10 md:pb-12 md:pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/40">
            Your activity
          </p>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl md:text-5xl">
                Watch History
              </h1>

              <p className="mt-3 max-w-xl text-sm leading-6 text-white/50 sm:text-base">
                Pick up where you left off or revisit something you have already
                watched.
              </p>
            </div>

            {history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                disabled={clearing}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 transition hover:border-white/20 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/50"
              >
                {clearing ? "Clearing..." : "Clear History"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="mx-auto max-w-[1800px] px-5 py-8 pb-16 md:px-10 md:py-10">
        {history.length === 0 ? (
          <div className="flex min-h-[55vh] items-center justify-center">
            <div className="max-w-md text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl text-white/40">
                ▶
              </div>

              <h2 className="mt-6 text-2xl font-bold">
                No watch history yet
              </h2>

              <p className="mt-3 text-sm leading-6 text-white/45 sm:text-base">
                Videos you watch will appear here so you can quickly return to
                them later.
              </p>

              <Link
                href="/"
                className="mt-7 inline-flex rounded-md bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#141414]"
              >
                Browse titles
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {history.map((item) => {
              const video = item.video;

              const duration =
                item.durationSeconds || video.duration || 0;

              const progress =
                duration > 0
                  ? Math.min(
                      100,
                      (item.positionSeconds / duration) * 100
                    )
                  : 0;

              const metadata = [
                video.releaseYear
                  ? String(video.releaseYear)
                  : "",
                video.ageRating || "",
                formatGenres(video.genre),
              ].filter(Boolean);

              return (
                <Link
                  key={item.id}
                  href={`/watch/${video.id}`}
                  className="group min-w-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-4 focus:ring-offset-[#141414]"
                >
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-[#181818] shadow-lg shadow-black/20">
                    {video.thumbnailPath ? (
                      <img
                        src={video.thumbnailPath}
                        alt={video.title}
                        className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-800 to-black">
                        <span className="text-3xl text-white/20">▶</span>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/10 opacity-70 transition group-hover:opacity-100" />

                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-200 group-hover:opacity-100">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-xl">
                        ▶
                      </div>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                      <div
                        className="h-full bg-red-600 transition-[width] duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    {item.completed && (
                      <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white/90 backdrop-blur">
                        Watched
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    <h3 className="truncate text-sm font-semibold text-white transition group-hover:text-white/80">
                      {video.title}
                    </h3>

                    {metadata.length > 0 && (
                      <p className="mt-1 truncate text-xs text-white/45">
                        {metadata.join(" • ")}
                      </p>
                    )}

                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/40">
                      {item.completed ? (
                        <span>Finished watching</span>
                      ) : duration > 0 ? (
                        <span>
                          {formatDuration(item.positionSeconds)} watched
                        </span>
                      ) : (
                        <span>Continue watching</span>
                      )}

                      <span className="shrink-0">{Math.round(progress)}%</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}