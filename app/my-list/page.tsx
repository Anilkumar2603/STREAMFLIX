"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import VideoCard from "@/components/video-card";

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

export default function MyListPage() {
  const [videos, setVideos] =
    useState<Video[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchMyList() {
      try {
        const response =
          await fetch("/api/my-list", {
            cache: "no-store",
          });

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Failed to load My List"
          );
        }

        if (!cancelled) {
          setVideos(
            Array.isArray(data)
              ? data
              : []
          );
        }
      } catch (error) {
        console.error(
          "My List loading error:",
          error
        );

        if (!cancelled) {
          setError(
            error instanceof Error
              ? error.message
              : "Failed to load My List"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchMyList();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Loading
   */
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#141414] text-white">

        <div className="text-center">

          <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />

          <p className="text-gray-400">
            Loading My List...
          </p>

        </div>

      </main>
    );
  }

  /*
   * Authentication required
   */
  if (
    error ===
    "Authentication required"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#141414] px-6 text-white">

        <div className="text-center">

          <h1 className="text-2xl font-semibold">
            Sign in required
          </h1>

          <p className="mt-3 text-gray-500">
            Sign in to access your My List.
          </p>

          <Link
            href="/login"
            className="mt-6 inline-block rounded-md bg-red-600 px-6 py-3 font-semibold transition hover:bg-red-700"
          >
            Sign In
          </Link>

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
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            ← Browse
          </Link>
        </div>
      </header>

      {/* Page header */}
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.045] via-transparent to-black/40" />
        <div className="relative mx-auto max-w-[1800px] px-5 pb-10 pt-10 md:px-10 md:pb-12 md:pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/40">
            Your collection
          </p>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl md:text-5xl">
                My List
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/50 sm:text-base">
                Keep your favorite titles together and come back whenever
                you&apos;re ready to watch.
              </p>
            </div>

            {!loading && !error && (
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60">
                {videos.length} {videos.length === 1 ? "title" : "titles"}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="mx-auto max-w-[1800px] px-5 py-8 pb-16 md:px-10 md:py-10">
        {error && error !== "Authentication required" && (
          <div className="mb-6 rounded-md border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {videos.length === 0 ? (
          <div className="flex min-h-[55vh] items-center justify-center">
            <div className="max-w-md text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5 text-3xl text-white/40">
                +
              </div>
              <h2 className="mt-6 text-2xl font-bold">Your list is empty</h2>
              <p className="mt-3 text-sm leading-6 text-white/45 sm:text-base">
                Add movies and shows you want to watch later. They&apos;ll appear
                here for quick access.
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
          <div className="grid grid-cols-2 gap-x-3 gap-y-9 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
