"use client";

import Link from "next/link";

type Video = {
  id: string;
  title: string;
  status: string;
  thumbnailPath: string | null;
  duration: number | null;
  genre: string | null;
  releaseYear: number | null;
  ageRating: string | null;
};

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M8 5.14v13.72c0 .78.85 1.26 1.52.86l10.72-6.86a1 1 0 0 0 0-1.72L9.52 4.28A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export default function VideoCard({ video }: { video: Video }) {
  const isReady = video.status === "READY";

  if (!isReady) {
    return (
      <div className="group relative min-w-[220px] max-w-[220px] shrink-0 overflow-hidden rounded-lg bg-[#181818] md:min-w-[260px] md:max-w-[260px]">
        <div className="relative aspect-video">
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#202020] via-[#151515] to-[#080808]">
            <div className="text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-white/10 border-t-white/70" />
              <p className="text-xs text-gray-500">Processing</p>
            </div>
          </div>
        </div>
        <div className="p-3">
          <h3 className="truncate text-sm font-medium text-white">{video.title}</h3>
          <p className="mt-1 text-xs text-gray-500">Not available yet</p>
        </div>
      </div>
    );
  }

  const metadata = [
    video.releaseYear ? String(video.releaseYear) : "",
    video.ageRating || "",
    formatGenres(video.genre),
  ].filter(Boolean);

  return (
    <Link
      href={`/video/${video.id}`}
      aria-label={`Open ${video.title}`}
      className="group/card relative min-w-[220px] max-w-[220px] shrink-0 md:min-w-[260px] md:max-w-[260px]"
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-[#181818] shadow-lg ring-1 ring-white/5 transition duration-300 ease-out group-hover/card:z-20 group-hover/card:scale-[1.025] group-hover/card:shadow-2xl group-focus-visible/card:z-20 group-focus-visible/card:ring-2 group-focus-visible/card:ring-white">
        {video.thumbnailPath ? (
          <img
            src={video.thumbnailPath}
            alt={video.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 ease-out group-hover/card:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-800 to-black">
            <span className="text-3xl text-white/20">▶</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent opacity-0 transition duration-300 group-hover/card:opacity-100 group-focus-visible/card:opacity-100" />

        <div className="absolute inset-x-0 bottom-0 translate-y-2 p-3 opacity-0 transition duration-300 group-hover/card:translate-y-0 group-hover/card:opacity-100 group-focus-visible/card:translate-y-0 group-focus-visible/card:opacity-100">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105">
              <PlayIcon />
            </span>
            <span className="text-xs font-medium text-white">Play</span>
          </div>
        </div>

        {video.duration !== null && (
          <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {formatDuration(video.duration)}
          </div>
        )}
      </div>

      <div className="mt-2 min-w-0 px-0.5">
        <h3 className="truncate text-sm font-semibold text-white transition-colors group-hover/card:text-white">
          {video.title}
        </h3>
        {metadata.length > 0 && (
          <p className="mt-1 truncate text-xs text-gray-400">{metadata.join(" • ")}</p>
        )}
      </div>
    </Link>
  );
}
