"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);

    try {
      const response = await fetch(
        "/api/auth/logout",
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to sign out"
        );
      }

      /*
       * Notify components in the SAME tab.
       */
      window.dispatchEvent(
        new CustomEvent(
          "streamflix-logout"
        )
      );

      /*
       * Notify other tabs using
       * BroadcastChannel.
       */
      try {
        const channel =
          new BroadcastChannel(
            "streamflix-auth"
          );

        channel.postMessage({
          type: "LOGOUT",
        });

        channel.close();
      } catch {
        // Ignore if BroadcastChannel
        // is unavailable.
      }

      /*
       * Fallback for other tabs.
       */
      try {
        localStorage.setItem(
          "streamflix_logout",
          Date.now().toString()
        );
      } catch {
        // Ignore storage errors.
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loading}
      className="w-full rounded-md px-4 py-2 text-left text-sm text-gray-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
    >
      {loading
        ? "Signing out..."
        : "Sign Out"}
    </button>
  );
}