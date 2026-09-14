"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import VideoReviews from "@/components/video-reviews";
type Video = {
  id: string;
  title: string;
  description: string | null;
  genre: string | null;
  releaseYear: number | null;
  ageRating: string | null;
  status: string;
  published: boolean;
  streamPath: string | null;
  thumbnailPath: string | null;
  duration: number | null;
};

export default function VideoDetailsPage() {
  const params = useParams();
  const id = params.id as string;

  const [video, setVideo] =
    useState<Video | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [authenticated, setAuthenticated] =
    useState(false);

  const [checkingAuth, setCheckingAuth] =
    useState(true);

  const [inMyList, setInMyList] =
    useState(false);

  const [myListLoading, setMyListLoading] =
    useState(true);

  const [myListSaving, setMyListSaving] =
    useState(false);

  const [relatedVideos, setRelatedVideos] =
    useState<Video[]>([]);

  /*
   * Check authentication.
   */
  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const response =
          await fetch(
            "/api/auth/me",
            {
              cache: "no-store",
            }
          );

        if (!response.ok) {
          if (!cancelled) {
            setAuthenticated(false);
          }

          return;
        }

        const data =
          await response.json();

        if (!cancelled) {
          setAuthenticated(
            data.authenticated === true
          );
        }
      } catch (error) {
        console.error(
          "Authentication check error:",
          error
        );

        if (!cancelled) {
          setAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setCheckingAuth(false);
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Load video.
   */
  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function loadVideo() {
      try {
        const response =
          await fetch(
            `/api/videos/${id}`,
            {
              cache: "no-store",
            }
          );

        if (!response.ok) {
          throw new Error(
            "Video not found"
          );
        }

        const data =
          await response.json();

        if (!cancelled) {
          setVideo(data);
        }
      } catch (error) {
        console.error(
          "Video loading error:",
          error
        );

        if (!cancelled) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to load video"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadVideo();

    return () => {
      cancelled = true;
    };
  }, [id]);

  /*
   * Load related titles from the existing public video feed.
   */
  useEffect(() => {
    if (!video || !video.genre) return;

    let cancelled = false;

    async function loadRelated() {
      try {
        const response = await fetch("/api/videos", { cache: "no-store" });
        if (!response.ok) return;

        const data = await response.json();
        const videos = Array.isArray(data) ? data : data.videos;

        if (!cancelled && Array.isArray(videos)) {
          setRelatedVideos(
            videos
              .filter(
                (item: Video) =>
                  video &&
                  item.id !== video.id &&
                  item.status === "READY" &&
                  item.published === true &&
                  item.streamPath &&
                  item.genre &&
                  item.genre.toLowerCase() === video.genre!.toLowerCase()
              )
              .slice(0, 6)
          );
        }
      } catch {
        // Related content is optional; keep the main details page usable.
      }
    }

    loadRelated();

    return () => {
      cancelled = true;
    };
  }, [video]);

  /*
   * Check whether this video is already
   * in the user's My List.
   *
   * Only authenticated users need this.
   */
  useEffect(() => {
    if (
      checkingAuth ||
      !authenticated ||
      !id
    ) {
      if (!checkingAuth && !authenticated) {
        setMyListLoading(false);
      }

      return;
    }

    let cancelled = false;

    async function checkMyList() {
      try {
        const response =
          await fetch(
            "/api/my-list",
            {
              cache: "no-store",
            }
          );

        if (!response.ok) {
          return;
        }

        const data =
          await response.json();

        if (!cancelled) {
          const exists =
            Array.isArray(data) &&
            data.some(
              (item: Video) =>
                item.id === id
            );

          setInMyList(exists);
        }
      } catch (error) {
        console.error(
          "My List check error:",
          error
        );
      } finally {
        if (!cancelled) {
          setMyListLoading(false);
        }
      }
    }

    checkMyList();

    return () => {
      cancelled = true;
    };
  }, [
    authenticated,
    checkingAuth,
    id,
  ]);

  /*
   * Add/remove video from My List.
   */
  async function toggleMyList() {
    if (!authenticated || !video) {
      return;
    }

    setMyListSaving(true);

    try {
      const response =
        await fetch(
          "/api/my-list",
          {
            method: inMyList
              ? "DELETE"
              : "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              videoId: video.id,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to update My List"
        );
      }

      setInMyList(
        !inMyList
      );
    } catch (error) {
      console.error(
        "My List update error:",
        error
      );
    } finally {
      setMyListSaving(false);
    }
  }

  /*
   * Format duration.
   */
  function formatDuration(
    seconds: number | null
  ) {
    if (
      seconds === null ||
      !Number.isFinite(seconds)
    ) {
      return "";
    }

    const totalSeconds =
      Math.floor(seconds);

    const hours =
      Math.floor(
        totalSeconds / 3600
      );

    const minutes =
      Math.floor(
        (totalSeconds % 3600) /
          60
      );

    const remainingSeconds =
      totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(
        minutes
      ).padStart(
        2,
        "0"
      )}:${String(
        remainingSeconds
      ).padStart(
        2,
        "0"
      )}`;
    }

    return `${minutes}:${String(
      remainingSeconds
    ).padStart(
      2,
      "0"
    )}`;
  }

  /*
   * Loading.
   */
  if (
    loading ||
    checkingAuth
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">

        <div className="text-center">

          <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />

          <p className="text-gray-400">
            Loading...
          </p>

        </div>

      </main>
    );
  }

  /*
   * Error.
   */
  if (error || !video) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="text-center">

          <h1 className="text-2xl font-semibold">
            Video unavailable
          </h1>

          <p className="mt-3 text-sm text-gray-500">
            {error ||
              "This video could not be found."}
          </p>

          <Link
            href="/"
            className="mt-6 inline-block rounded-md bg-white px-6 py-3 text-sm font-semibold text-black"
          >
            Back to Browse
          </Link>

        </div>

      </main>
    );
  }

  /*
   * Video must be ready, published and
   * have a playable stream.
   */
  if (
    video.status !== "READY" ||
    video.published !== true ||
    !video.streamPath
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="text-center">

          <h1 className="text-2xl font-semibold">
            Video unavailable
          </h1>

          <p className="mt-3 text-gray-500">
            This video is currently unavailable.
          </p>

          <Link
            href="/"
            className="mt-6 inline-block rounded-md bg-white px-6 py-3 text-sm font-semibold text-black"
          >
            Back to Browse
          </Link>

        </div>

      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      {/* Hero */}
      <section className="relative min-h-[680px] overflow-hidden md:min-h-[760px]">
        <div className="absolute inset-0">
          {video.thumbnailPath ? (
            <img
              src={video.thumbnailPath}
              alt=""
              className="h-full w-full object-cover object-center opacity-70"
            />
          ) : (
            <div className="h-full w-full bg-zinc-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-black/40" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-transparent" />
        </div>

        <header className="relative z-20 flex items-center justify-between px-5 py-5 md:px-10 md:py-7">
          <Link href="/" className="text-xl font-black tracking-tight md:text-2xl">
            STREAMFLIX
          </Link>
          <Link
            href="/"
            className="rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm text-white/85 backdrop-blur transition hover:bg-white/10 hover:text-white"
          >
            ← Browse
          </Link>
        </header>

        <div className="relative z-10 flex min-h-[600px] items-end px-5 pb-20 pt-16 md:min-h-[680px] md:px-10 md:pb-24">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-white/75">
              {video.releaseYear && <span>{video.releaseYear}</span>}
              {video.ageRating && (
                <span className="rounded border border-white/35 px-2 py-0.5 text-xs text-white/90">
                  {video.ageRating}
                </span>
              )}
              {video.genre && <span>{video.genre}</span>}
              {video.duration !== null && <span>{formatDuration(video.duration)}</span>}
              <span className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/60">HD</span>
            </div>

            <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl md:text-7xl">
              {video.title}
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-white/75 md:text-lg">
              {video.description || "Watch this title in high-quality adaptive streaming."}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={`/watch/${video.id}`}
                className="inline-flex items-center gap-2 rounded-md bg-white px-7 py-3.5 font-bold text-black transition hover:bg-white/85"
              >
                <span className="text-lg">▶</span>
                Play Now
              </Link>

              {authenticated && (
                <button
                  type="button"
                  onClick={toggleMyList}
                  disabled={myListLoading || myListSaving}
                  className="inline-flex min-w-[145px] items-center justify-center gap-2 rounded-md border border-white/20 bg-white/10 px-6 py-3.5 font-semibold text-white backdrop-blur transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {myListSaving ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : inMyList ? (
                    <>✓ In My List</>
                  ) : (
                    <>＋ My List</>
                  )}
                </button>
              )}
            </div>

            {!authenticated && (
              <p className="mt-5 text-sm text-white/45">
                <Link href="/login" className="text-white/80 hover:underline">Sign in</Link> to add this title to your My List.
              </p>
            )}
          </div>
        </div>
      </section>

      {relatedVideos.length > 0 && (
        <section className="mx-auto max-w-7xl px-5 pb-14 md:px-10">
          <h2 className="mb-5 text-2xl font-bold">More Like This</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {relatedVideos.map((item) => (
              <Link
                key={item.id}
                href={`/video/${item.id}`}
                className="group overflow-hidden rounded-lg bg-white/[0.04] transition hover:-translate-y-1 hover:bg-white/[0.08]"
              >
                <div className="aspect-video overflow-hidden bg-zinc-900">
                  {item.thumbnailPath ? (
                    <img
                      src={item.thumbnailPath}
                      alt={item.title}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-white/30">No image</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-white/40">
                    {[item.releaseYear, item.ageRating].filter(Boolean).join(" • ")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Main content */}
      <section className="mx-auto max-w-7xl px-5 pb-16 md:px-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="border-b border-white/10 pb-10">
              <h2 className="text-xl font-bold">About this title</h2>
              <p className="mt-4 max-w-3xl leading-7 text-white/60">
                {video.description || "No description is available for this title yet."}
              </p>
            </div>

            <div className="pt-10">
              <VideoReviews videoId={video.id} />
            </div>
          </div>

          <aside className="h-fit rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <h2 className="text-lg font-bold">Details</h2>
            <dl className="mt-5 space-y-4 text-sm">
              {video.releaseYear && (
                <div className="flex justify-between gap-5">
                  <dt className="text-white/45">Release year</dt>
                  <dd className="text-right text-white/80">{video.releaseYear}</dd>
                </div>
              )}
              {video.genre && (
                <div className="flex justify-between gap-5">
                  <dt className="text-white/45">Genre</dt>
                  <dd className="text-right text-white/80">{video.genre}</dd>
                </div>
              )}
              {video.ageRating && (
                <div className="flex justify-between gap-5">
                  <dt className="text-white/45">Rating</dt>
                  <dd className="text-right text-white/80">{video.ageRating}</dd>
                </div>
              )}
              {video.duration !== null && (
                <div className="flex justify-between gap-5">
                  <dt className="text-white/45">Runtime</dt>
                  <dd className="text-right text-white/80">{formatDuration(video.duration)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-5">
                <dt className="text-white/45">Quality</dt>
                <dd className="text-right text-white/80">Adaptive HD</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </main>
  );
}
