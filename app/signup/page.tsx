"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          password,
        }),
      });

      const responseText = await response.text();

      let result: {
        success?: boolean;
        error?: string;
      } = {};

      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          result = {};
        }
      }

      if (!response.ok) {
        throw new Error(
          result.error ||
            `Signup failed (${response.status})`
        );
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="absolute left-0 right-0 top-0 z-20">
        <div className="flex items-center px-6 py-5 md:px-10">
          <Link
            href="/"
            className="text-2xl font-black tracking-tight text-red-600 md:text-3xl"
          >
            STREAMFLIX
          </Link>
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center px-6 py-24">
        <div className="w-full max-w-md">
          <div className="rounded-md bg-zinc-900/90 p-8 shadow-2xl md:p-10">
            <h1 className="text-3xl font-bold">
              Create your account
            </h1>

            <p className="mt-2 text-sm text-gray-400">
              Join STREAMFLIX and start watching.
            </p>

            {error && (
              <div className="mt-6 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-5"
            >
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-gray-300"
                >
                  Name
                </label>

                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  placeholder="Your name"
                  autoComplete="name"
                  required
                  disabled={loading}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-4 py-3 text-white outline-none transition placeholder:text-gray-500 focus:border-white disabled:opacity-50"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-gray-300"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={loading}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-4 py-3 text-white outline-none transition placeholder:text-gray-500 focus:border-white disabled:opacity-50"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-gray-300"
                >
                  Password
                </label>

                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={loading}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-4 py-3 text-white outline-none transition placeholder:text-gray-500 focus:border-white disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-red-600 py-3 font-semibold transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? "Creating account..."
                  : "Create Account"}
              </button>
            </form>

            <div className="mt-8 border-t border-zinc-800 pt-6 text-center text-sm text-gray-400">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-white hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}