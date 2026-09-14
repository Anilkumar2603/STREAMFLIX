"use client";

import { useRef, useState } from "react";
import VideoCard from "./video-card";

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

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current stroke-[2.5]">
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function VideoRow({ title, videos }: { title: string; videos: Video[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(videos.length > 1);

  if (videos.length === 0) return null;

  function updateArrows() {
    const el = rowRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  function scroll(direction: "left" | "right") {
    const el = rowRef.current;
    if (!el) return;

    el.scrollBy({
      left: direction === "left" ? -Math.max(el.clientWidth * 0.82, 520) : Math.max(el.clientWidth * 0.82, 520),
      behavior: "smooth",
    });

    window.setTimeout(updateArrows, 350);
  }

  return (
    <section className="group/row relative mb-9 md:mb-11" aria-label={title}>
      <div className="mb-3 flex items-end justify-between px-6 md:mb-4 md:px-10">
        <h2 className="text-lg font-semibold tracking-tight text-white md:text-xl">{title}</h2>
        <span className="mr-1 hidden text-xs text-gray-500 transition group-hover/row:text-gray-300 md:block">
          Explore
        </span>
      </div>

      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll("left")}
          aria-label={`Scroll ${title} left`}
          className="absolute left-1 top-[calc(50%+12px)] z-30 hidden h-20 w-10 -translate-y-1/2 items-center justify-center rounded-r-md bg-black/75 text-white shadow-xl backdrop-blur-sm transition hover:bg-black/95 md:flex"
        >
          <Chevron direction="left" />
        </button>
      )}

      <div
        ref={rowRef}
        onScroll={updateArrows}
        className="flex gap-3 overflow-x-auto overflow-y-visible px-6 pb-3 pt-1 scrollbar-none md:gap-4 md:px-10"
        style={{ scrollbarWidth: "none" }}
      >
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
      </div>

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll("right")}
          aria-label={`Scroll ${title} right`}
          className="absolute right-1 top-[calc(50%+12px)] z-30 hidden h-20 w-10 -translate-y-1/2 items-center justify-center rounded-l-md bg-black/75 text-white shadow-xl backdrop-blur-sm transition hover:bg-black/95 md:flex"
        >
          <Chevron direction="right" />
        </button>
      )}
    </section>
  );
}
