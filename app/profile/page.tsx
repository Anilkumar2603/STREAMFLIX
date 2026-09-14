"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LogoutButton from "@/components/logout-button";

type User = {
  id: string;
  name: string;
  email: string;
};

export default function ProfilePage() {
  const [user, setUser] =
    useState<User | null>(null);

  const [name, setName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  /*
   * Load profile.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const response =
          await fetch(
            "/api/auth/profile",
            {
              cache: "no-store",
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Failed to load profile"
          );
        }

        if (!cancelled) {
          setUser(data.user);
          setName(data.user.name);
          setEmail(data.user.email);
        }
      } catch (error) {
        console.error(
          "Profile loading error:",
          error
        );

        if (!cancelled) {
          setError(
            error instanceof Error
              ? error.message
              : "Failed to load profile"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Save profile.
   */
  async function saveProfile(
    event: React.FormEvent
  ) {
    event.preventDefault();

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/auth/profile",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              name,
              email,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to update profile"
        );
      }

      setUser(data.user);
      setName(data.user.name);
      setEmail(data.user.email);

      setMessage(
        "Profile updated successfully."
      );

      /*
       * Update any homepage/profile
       * components that are listening.
       */
      window.dispatchEvent(
        new CustomEvent(
          "streamflix-profile-updated",
          {
            detail: data.user,
          }
        )
      );
    } catch (error) {
      console.error(
        "Profile update error:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Failed to update profile"
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * Loading.
   */
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#141414] text-white">

        <div className="text-center">

          <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />

          <p className="text-gray-400">
            Loading profile...
          </p>

        </div>

      </main>
    );
  }

  /*
   * Not authenticated / error.
   */
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#141414] px-6 text-white">

        <div className="text-center">

          <h1 className="text-2xl font-semibold">
            Sign in required
          </h1>

          <p className="mt-3 text-gray-500">
            Please sign in to view your profile.
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
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#141414]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-5 md:px-10">
          <Link
            href="/"
            className="text-xl font-black tracking-tight text-white transition hover:text-white/80 md:text-2xl"
          >
            STREAMFLIX
          </Link>

          <Link
            href="/"
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white"
          >
            ← Browse
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.045] via-transparent to-black/40" />

        <div className="relative mx-auto flex max-w-[1400px] flex-col gap-5 px-5 py-10 sm:flex-row sm:items-center md:px-10 md:py-14">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-3xl font-black shadow-2xl shadow-black/30 sm:h-24 sm:w-24 sm:text-4xl">
            {user.name.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/40">
              Account
            </p>
            <h1 className="mt-2 truncate text-3xl font-black tracking-tight sm:text-4xl">
              {user.name}
            </h1>
            <p className="mt-2 truncate text-sm text-white/45">
              {user.email}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 py-8 pb-16 md:px-10 md:py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
              Personal information
            </p>

            <h2 className="mt-2 text-xl font-bold">
              Profile details
            </h2>

            <p className="mt-2 text-sm leading-6 text-white/45">
              Update the name and email address associated with your
              Streamflix account.
            </p>

            <form onSubmit={saveProfile} className="mt-8 space-y-5">
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-white/75"
                >
                  Name
                </label>

                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30 focus:bg-black/50 focus:ring-2 focus:ring-white/10"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-white/75"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30 focus:bg-black/50 focus:ring-2 focus:ring-white/10"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-lg border border-green-900/60 bg-green-950/30 px-4 py-3 text-sm text-green-400">
                  {message}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#141414]"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>

                <span className="text-xs text-white/30">
                  Changes apply to your account immediately.
                </span>
              </div>
            </form>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
                Your Streamflix
              </p>

              <div className="mt-4 space-y-2">
                <Link
                  href="/my-list"
                  className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <span>My List</span>
                  <span className="text-white/30">→</span>
                </Link>

                <Link
                  href="/history"
                  className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <span>Watch History</span>
                  <span className="text-white/30">→</span>
                </Link>
              </div>
            </div>

            <div className="rounded-xl border border-red-900/30 bg-red-950/10 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-400/60">
                Account
              </p>

              <h3 className="mt-2 font-semibold text-white">
                Sign out
              </h3>

              <p className="mt-2 text-sm leading-6 text-white/40">
                Sign out of Streamflix on this device.
              </p>

              <div className="mt-4">
                <LogoutButton />
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}