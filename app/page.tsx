"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LogoutButton from "@/components/logout-button";
import VideoRow from "@/components/video-row";
import VideoCard from "@/components/video-card";
import ContinueWatchingRow from "@/components/continue-watching-row";
type Video = {
  id: string;
  title: string;

  // Viewer metadata
  description: string | null;
  genre: string | null;
  releaseYear: number | null;
  ageRating: string | null;
  featured: boolean;
  published: boolean;

  // Playback
  status: string;
  streamPath: string | null;
  thumbnailPath: string | null;
  duration: number | null;

  // Processing data
  progress: number;
  processingFps: number | null;
  processingSpeed: number | null;
  processingElapsed: number | null;
  processingEta: number | null;
  processingStage: string | null;
  encoderUsed: string | null;

  createdAt: string;
};

type CurrentUser = {
  id: string;
  name: string;
  email: string;
};

export default function HomePage() {
  const [currentUser, setCurrentUser] =
    useState<CurrentUser | null>(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  const [profileOpen, setProfileOpen] =
    useState(false);

  const [mobileNavOpen, setMobileNavOpen] =
    useState(false);

  const [videos, setVideos] =
    useState<Video[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  // Search
  const [searchOpen, setSearchOpen] =
    useState(false);

  const [searchQuery, setSearchQuery] =
    useState("");

  /*
   * Load current logged-in user.
   */
  useEffect(() => {
    let cancelled = false;

    async function fetchCurrentUser() {
      try {
        const response = await fetch(
          "/api/auth/me",
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          if (!cancelled) {
            setCurrentUser(null);
          }

          return;
        }

        const data = await response.json();

        if (!cancelled) {
          setCurrentUser(
            data.authenticated === true
              ? data.user ?? null
              : null
          );
        }
      } catch (error) {
        console.error(
          "Failed to fetch current user:",
          error
        );

        if (!cancelled) {
          setCurrentUser(null);
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    }

    fetchCurrentUser();

    return () => {
      cancelled = true;
    };
  }, []);
/*
 * Listen for logout events.
 *
 * This handles:
 * 1. Logout from this tab
 * 2. Logout from another tab
 */
useEffect(() => {
  function handleLogout() {
    setCurrentUser(null);
    setProfileOpen(false);
  }

  /*
   * Same-tab logout.
   */
  window.addEventListener(
    "streamflix-logout",
    handleLogout
  );

  /*
   * Other-tab logout using BroadcastChannel.
   */
  let channel:
    BroadcastChannel | null = null;

  try {
    channel = new BroadcastChannel(
      "streamflix-auth"
    );

    channel.onmessage = (event) => {
      if (
        event.data?.type ===
        "LOGOUT"
      ) {
        handleLogout();
      }
    };
  } catch {
    channel = null;
  }

  /*
   * Other-tab fallback.
   */
  function handleStorage(
    event: StorageEvent
  ) {
    if (
      event.key ===
      "streamflix_logout"
    ) {
      handleLogout();
    }
  }

  window.addEventListener(
    "storage",
    handleStorage
  );

  return () => {
    window.removeEventListener(
      "streamflix-logout",
      handleLogout
    );

    window.removeEventListener(
      "storage",
      handleStorage
    );

    channel?.close();
  };
}, []);
  /*
   * Load videos.
   *
   * The public catalog is refreshed every 3 seconds
   * so newly published/processed content can appear
   * without manually refreshing the browser.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadVideos() {
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

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error(
            "Invalid video response"
          );
        }

        if (!cancelled) {
          setVideos(data);
          setError("");
        }
      } catch (error) {
        console.error(
          "Video loading error:",
          error
        );

        if (!cancelled) {
          setError(
            "Unable to load videos."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadVideos();

    const interval =
      window.setInterval(
        loadVideos,
        3000
      );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  /*
   * ONLY videos that are:
   *
   * 1. Fully processed
   * 2. Published by admin
   * 3. Have a playable HLS stream
   */
  const readyVideos = useMemo(
    () =>
      videos.filter(
        (video) =>
          video.status === "READY" &&
          video.published === true &&
          Boolean(video.streamPath)
      ),
    [videos]
  );

  /*
   * Recently added.
   */
  const recentVideos = useMemo(
    () =>
      [...readyVideos].sort(
        (a, b) =>
          new Date(
            b.createdAt
          ).getTime() -
          new Date(
            a.createdAt
          ).getTime()
      ),
    [readyVideos]
  );

  /*
   * Featured video.
   *
   * First preference:
   * Admin-selected featured title
   *
   * Fallback:
   * Most recently added title
   */
  const featuredVideo = useMemo(() => {
    const selectedFeatured =
      readyVideos.find(
        (video) =>
          video.featured === true
      );

    return (
      selectedFeatured ??
      recentVideos[0] ??
      null
    );
  }, [
    readyVideos,
    recentVideos,
  ]);

  /*
   * Trending.
   */
  const trendingVideos = useMemo(
    () =>
      recentVideos.slice(0, 10),
    [recentVideos]
  );

  /*
   * Popular.
   *
   * Until view-count analytics exist,
   * duration is used as a temporary ordering.
   */
  const popularVideos = useMemo(
    () =>
      [...readyVideos]
        .sort(
          (a, b) =>
            (b.duration ?? 0) -
            (a.duration ?? 0)
        )
        .slice(0, 10),
    [readyVideos]
  );

  /*
   * Build genre rows dynamically.
   */
  const genreRows = useMemo(() => {
    const genreMap = new Map<
      string,
      Video[]
    >();

    readyVideos.forEach(
      (video) => {
        if (!video.genre) {
          return;
        }

        const genres =
          video.genre
            .split(",")
            .map(
              (genre) =>
                genre.trim()
            )
            .filter(Boolean);

        genres.forEach(
          (genre) => {
            if (
              !genreMap.has(
                genre
              )
            ) {
              genreMap.set(
                genre,
                []
              );
            }

            genreMap
              .get(genre)!
              .push(video);
          }
        );
      }
    );

    return Array.from(
      genreMap.entries()
    ).slice(0, 8);
  }, [readyVideos]);

  /*
   * Search results.
   *
   * Search can match:
   * - title
   * - description
   * - genre
   * - release year
   * - age rating
   */
  const searchResults = useMemo(() => {
    const query =
      searchQuery
        .trim()
        .toLowerCase();

    if (!query) {
      return [];
    }

    return readyVideos.filter(
      (video) => {
        const searchableText = [
          video.title,
          video.description ?? "",
          video.genre ?? "",
          video.releaseYear?.toString() ??
            "",
          video.ageRating ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(
          query
        );
      }
    );
  }, [
    readyVideos,
    searchQuery,
  ]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      setMobileNavOpen(false);
      setProfileOpen(false);

      if (searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [searchOpen]);

  const isSearching =
    searchOpen &&
    searchQuery.trim().length > 0;

  return (
    <main className="min-h-screen bg-[#141414] text-white">

      {/* =========================
          NAVBAR
      ========================== */}

      <header className="fixed left-0 right-0 top-0 z-50 bg-gradient-to-b from-black/90 via-black/50 to-transparent">
        <div className="relative flex h-16 items-center justify-between px-5 md:px-10">

          {/* Logo */}

          <Link
            href="/"
            className="text-xl font-black tracking-tight text-white md:text-2xl"
            onClick={() => setMobileNavOpen(false)}
          >
            STREAMFLIX
          </Link>

          {/* Desktop navigation */}

          <nav className="hidden items-center gap-6 text-sm text-gray-300 md:flex">

            <Link
              href="/"
              className="font-medium text-white transition hover:text-gray-300"
            >
              Home
            </Link>

            <a
              href="#trending"
              className="transition hover:text-white"
            >
              Movies
            </a>

            <a
              href="#genres"
              className="transition hover:text-white"
            >
              Series
            </a>

            <a
              href="#recent"
              className="transition hover:text-white"
            >
              New & Popular
            </a>

          </nav>

          {/* Mobile navigation toggle */}

          <button
            type="button"
            aria-label={
              mobileNavOpen
                ? "Close navigation menu"
                : "Open navigation menu"
            }
            aria-expanded={mobileNavOpen}
            onClick={() =>
              setMobileNavOpen((value) => !value)
            }
            className="ml-auto mr-3 flex h-9 w-9 items-center justify-center rounded-md text-gray-200 transition hover:bg-white/10 hover:text-white md:hidden"
          >
            <span className="text-xl leading-none">
              {mobileNavOpen ? "×" : "☰"}
            </span>
          </button>

          {/* Mobile navigation */}

          {mobileNavOpen && (
            <div className="absolute left-0 right-0 top-16 border-t border-white/10 bg-black/95 px-5 py-4 shadow-2xl backdrop-blur-xl md:hidden">
              <nav className="flex flex-col gap-1 text-sm">
                <Link
                  href="/"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-md bg-white/10 px-4 py-3 font-medium text-white transition hover:bg-white/15"
                >
                  Home
                </Link>

                <a
                  href="#trending"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-md px-4 py-3 text-gray-300 transition hover:bg-white/10 hover:text-white"
                >
                  Movies
                </a>

                <a
                  href="#genres"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-md px-4 py-3 text-gray-300 transition hover:bg-white/10 hover:text-white"
                >
                  Series
                </a>

                <a
                  href="#recent"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-md px-4 py-3 text-gray-300 transition hover:bg-white/10 hover:text-white"
                >
                  New & Popular
                </a>

                {currentUser && (
                  <>
                    <div className="my-2 border-t border-white/10" />

                    <Link
                      href="/profile"
                      onClick={() => setMobileNavOpen(false)}
                      className="rounded-md px-4 py-3 text-gray-300 transition hover:bg-white/10 hover:text-white"
                    >
                      Profile
                    </Link>

                    <Link
                      href="/history"
                      onClick={() => setMobileNavOpen(false)}
                      className="rounded-md px-4 py-3 text-gray-300 transition hover:bg-white/10 hover:text-white"
                    >
                      Watch History
                    </Link>

                    <Link
                      href="/my-list"
                      onClick={() => setMobileNavOpen(false)}
                      className="rounded-md px-4 py-3 text-gray-300 transition hover:bg-white/10 hover:text-white"
                    >
                      My List
                    </Link>
                  </>
                )}
              </nav>
            </div>
          )}

          {/* Search input */}

          {searchOpen && (
            <div
              className={`absolute left-5 right-5 z-50 md:left-auto md:right-24 md:w-80 ${
                mobileNavOpen ? "top-[21rem]" : "top-16"
              }`}
            >

              <div className="flex items-center rounded-md border border-white/20 bg-black/95 px-3 py-2 shadow-2xl shadow-black/40 backdrop-blur-xl">

                <span className="mr-2 text-lg text-gray-400">
                  ⌕
                </span>

                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) =>
                    setSearchQuery(
                      e.target.value
                    )
                  }
                  placeholder="Search titles, genres..."
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                />

                {searchQuery && (
                  <button
                    type="button"
                    onClick={() =>
                      setSearchQuery("")
                    }
                    className="ml-2 text-lg text-gray-400 hover:text-white"
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}

              </div>

            </div>
          )}

          {/* Search backdrop */}

          {searchOpen && (
            <button
              type="button"
              aria-label="Close search"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
              }}
              className="fixed inset-0 -z-10 bg-black/40 md:bg-black/20"
            />
          )}

          {/* Right side */}

          <div className="flex items-center gap-4">

            {/* Search */}

            <button
              type="button"
              aria-label="Search"
              onClick={() => {
                setSearchOpen(
                  (current) =>
                    !current
                );

                if (searchOpen) {
                  setSearchQuery("");
                }
              }}
              className="text-xl text-gray-200 transition hover:text-white"
            >
              ⌕
            </button>

            {/* Profile */}

            <div className="relative">

              {authLoading ? (
                <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-700" />
              ) : currentUser ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setProfileOpen(
                        (value) =>
                          !value
                      )
                    }
                    className="flex h-8 w-8 items-center justify-center rounded bg-red-600 text-sm font-bold text-white transition hover:bg-red-700"
                    aria-label="Profile menu"
                    aria-expanded={
                      profileOpen
                    }
                  >
                    {currentUser.name
                      .charAt(0)
                      .toUpperCase()}
                  </button>

                  {profileOpen && (
                    <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-2xl">

                      {/* User information */}

                      <div className="border-b border-zinc-800 px-4 py-3">

                        <p className="truncate text-sm font-semibold text-white">
                          {currentUser.name}
                        </p>

                        <p className="mt-1 truncate text-xs text-gray-500">
                          {currentUser.email}
                        </p>

                      </div>

                      {/* Menu */}

                      <div className="p-2">

                        {/* Profile */}

                          <Link
                          href="/profile"
                          onClick={() =>
                          setProfileOpen(false)
                          }
                          className="block w-full rounded-md px-4 py-2 text-left text-sm text-gray-300 transition hover:bg-zinc-800 hover:text-white"
                          >
                          Profile
                          </Link>

                        {/* Watch History */}
                        <Link
                          href="/history"
                          onClick={() => setProfileOpen(false)}
                          className="block w-full rounded-md px-4 py-2 text-left text-sm text-gray-300 transition hover:bg-zinc-800 hover:text-white"
                        >
                          Watch History
                        </Link>

                        {/* My List */}
                        <Link
                          href="/my-list"
                          onClick={() =>
                            setProfileOpen(false)
                          }
                          className="block w-full rounded-md px-4 py-2 text-left text-sm text-gray-300 transition hover:bg-zinc-800 hover:text-white"
                          >
                          My List
                          </Link>

                        {/* Logout */}

                        <LogoutButton />

                      </div>

                    </div>
                  )}

                </>
              ) : (
                <Link
                  href="/login"
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Sign In
                </Link>
              )}

            </div>

          </div>

        </div>
      </header>

      {/* =========================
          LOADING
      ========================== */}

      {loading && (
        <div className="flex min-h-screen items-center justify-center">

          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />

        </div>
      )}

      {/* =========================
          ERROR
      ========================== */}

      {!loading &&
        error && (
          <div className="flex min-h-screen items-center justify-center">

            <div className="text-center">

              <p className="text-gray-400">
                {error}
              </p>

              <button
                type="button"
                onClick={() =>
                  window.location.reload()
                }
                className="mt-5 rounded bg-white px-5 py-2 text-sm font-semibold text-black"
              >
                Try Again
              </button>

            </div>

          </div>
        )}

      {/* =========================
          EMPTY STATE
      ========================== */}

      {!loading &&
        !error &&
        readyVideos.length === 0 && (
          <div className="flex min-h-screen items-center justify-center px-6">

            <div className="text-center">

              <h1 className="text-3xl font-bold">
                Nothing to watch yet
              </h1>

              <p className="mt-3 text-gray-500">
                New content will appear here once it
                is ready.
              </p>

            </div>

          </div>
        )}

      {/* =========================
          SEARCH RESULTS
      ========================== */}

      {!loading &&
        !error &&
        isSearching && (
          <section className="relative z-20 min-h-screen bg-[#141414] px-5 pb-20 pt-24 md:px-10 lg:px-12">

            <div className="mx-auto max-w-[1800px]">

              {/* Search heading */}

              <div className="mb-8 flex flex-wrap items-end justify-between gap-3">

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">
                    Search
                  </p>

                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    Results for "{searchQuery}"
                  </h2>

                  <p className="mt-2 text-sm text-white/45">
                    {searchResults.length}{" "}
                    {searchResults.length === 1
                      ? "title"
                      : "titles"}{" "}
                    found
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchOpen(false);
                  }}
                  className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/50"
                >
                  Close search
                </button>

              </div>

              {searchResults.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">

                  {searchResults.map((video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                    />
                  ))}

                </div>
              ) : (
                <div className="flex min-h-[45vh] items-center justify-center">

                  <div className="max-w-md text-center">

                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl text-white/50">
                      ⌕
                    </div>

                    <h3 className="mt-5 text-xl font-semibold text-white">
                      No titles found
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-white/45">
                      We couldn't find anything matching "{searchQuery}".
                      Try another title, genre, year, or rating.
                    </p>

                  </div>

                </div>
              )}

            </div>

          </section>
        )}

      {/* =========================
          MAIN EXPERIENCE
      ========================== */}

      {!loading &&
        !error &&
        featuredVideo &&
        !isSearching && (
          <>

            {/* =========================
                HERO
            ========================== */}

            <section className="relative h-[78vh] min-h-[590px] max-h-[900px] overflow-hidden">

              {/* Cinematic background */}
              <div className="absolute inset-0 bg-black">
                {featuredVideo.thumbnailPath ? (
                  <img
                    src={featuredVideo.thumbnailPath}
                    alt=""
                    className="h-full w-full object-cover object-center opacity-95 motion-safe:transition-transform motion-safe:duration-1000"
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-zinc-900 via-zinc-950 to-black" />
                )}

                {/* OTT-style layered gradients */}
                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/65 to-black/10" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-black/35" />
                <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 to-transparent" />
                <div className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-black/20 to-transparent" />
              </div>

              {/* Hero content */}
              <div className="relative flex h-full items-end px-6 pb-24 md:px-10 md:pb-28 lg:pb-32">
                <div className="w-full max-w-2xl">

                  {/* Featured label */}
                  <div className="mb-4 flex items-center gap-3">
                    <span className="text-xs font-bold uppercase tracking-[0.3em] text-white/75">
                      Featured
                    </span>
                    <span className="h-px w-10 bg-white/35" />
                  </div>

                  <h1 className="max-w-3xl text-2xl font-black leading-[0.98] tracking-tight text-white sm:text-3xl md:text-4xl lg:text-5xl">
  {featuredVideo.title}
</h1>

                  {/* Metadata */}
                  <div className="mt-5 flex flex-wrap items-center gap-2.5 text-sm font-medium text-white/85">
                    {featuredVideo.releaseYear && (
                      <span>{featuredVideo.releaseYear}</span>
                    )}

                    {featuredVideo.ageRating && (
                      <span className="rounded border border-white/40 px-2 py-0.5 text-xs font-semibold">
                        {featuredVideo.ageRating}
                      </span>
                    )}

                    {featuredVideo.genre && (
                      <span className="max-w-xs truncate">
                        {featuredVideo.genre.split(",")[0].trim()}
                      </span>
                    )}

                    {featuredVideo.duration !== null && (
                      <span>{formatDuration(featuredVideo.duration)}</span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-6 text-white/75 sm:text-base sm:leading-7">
                    {featuredVideo.description ||
                      "Watch this title in adaptive high-quality streaming with automatic quality selection."}
                  </p>

                  {/* Primary actions */}
                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    <Link
                      href={`/watch/${featuredVideo.id}`}
                      className="group inline-flex items-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-bold text-black shadow-lg shadow-black/30 transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
                    >
                      <span className="text-base transition-transform group-hover:scale-110">▶</span>
                      Play
                    </Link>

                    <Link
                      href={`/video/${featuredVideo.id}`}
                      className="inline-flex items-center gap-2 rounded-md bg-white/15 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70"
                    >
                      <span className="text-base">ⓘ</span>
                      More Info
                    </Link>
                  </div>

                </div>
              </div>

              {/* Subtle bottom fade into content rows */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#141414] to-transparent" />
            </section>
                        {currentUser && <ContinueWatchingRow />}
            {/* =========================
                CONTENT
            ========================== */}

            <section className="-mt-8 relative z-10 pb-16">

              {/* Trending */}

              <div id="trending">

                <VideoRow
                  title="Trending Now"
                  videos={trendingVideos}
                />

              </div>

              {/* Recently Added */}

              <div id="recent">

                <VideoRow
                  title="Recently Added"
                  videos={recentVideos}
                />

              </div>

              {/* Popular */}

              <VideoRow
                title="Popular"
                videos={popularVideos}
              />

              {/* Genre rows */}

              <div id="genres">

                {genreRows.map(
                  ([
                    genre,
                    genreVideos,
                  ]) => (
                    <VideoRow
                      key={genre}
                      title={genre}
                      videos={
                        genreVideos
                      }
                    />
                  )
                )}

              </div>

            </section>

          </>
        )}

    </main>
  );
}

/* =========================
   HELPERS
========================= */

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

  const hours = Math.floor(
    totalSeconds / 3600
  );

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
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