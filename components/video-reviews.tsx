"use client";

import { useEffect, useState } from "react";

type Review = {
  id: string;
  userId: string;
  rating: number;
  review: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
  };
};

type ReviewsResponse = {
  reviews: Review[];
  average: number;
  count: number;
  currentUserReview: Review | null;
};

export default function VideoReviews({
  videoId,
}: {
  videoId: string;
}) {
  const [data, setData] = useState<ReviewsResponse>({
    reviews: [],
    average: 0,
    count: 0,
    currentUserReview: null,
  });

  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadReviews() {
    try {
      const response = await fetch(
        `/api/reviews?videoId=${encodeURIComponent(videoId)}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) return;

      const result = await response.json();

      setData(result);

      if (result.currentUserReview) {
        setRating(result.currentUserReview.rating);
        setReview(result.currentUserReview.review || "");
      }
    } catch (error) {
      console.error("Failed to load reviews:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReviews();
  }, [videoId]);

  async function submitReview() {
    if (rating < 1 || rating > 5) {
      setMessage("Please select a rating.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoId,
          rating,
          review,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to save review.");
        return;
      }

      setMessage("Review saved.");
      await loadReviews();
    } catch (error) {
      console.error("Failed to save review:", error);
      setMessage("Failed to save review.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteReview() {
    try {
      const response = await fetch(`/api/reviews/${videoId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        setMessage("Failed to delete review.");
        return;
      }

      setRating(0);
      setReview("");
      setMessage("Review deleted.");

      await loadReviews();
    } catch (error) {
      console.error("Failed to delete review:", error);
      setMessage("Failed to delete review.");
    }
  }

  if (loading) {
    return null;
  }

  return (
    <section className="mt-10 border-t border-white/10 pt-8">
      {/* Rating summary */}
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-xl font-semibold text-white">
          Ratings & Reviews
        </h2>

        {data.count > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-lg text-yellow-400">★</span>
            <span className="font-medium text-white">
              {data.average.toFixed(1)}
            </span>
            <span className="text-sm text-gray-500">
              ({data.count} {data.count === 1 ? "review" : "reviews"})
            </span>
          </div>
        )}
      </div>

      {/* User rating */}
      <div className="mt-6 rounded-lg bg-[#181818] p-5">
        <h3 className="text-sm font-medium text-white">
          {data.currentUserReview
            ? "Your rating"
            : "Rate this video"}
        </h3>

        <div className="mt-3 flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              className={`text-2xl transition ${
                value <= rating
                  ? "text-yellow-400"
                  : "text-gray-600 hover:text-gray-400"
              }`}
              aria-label={`Rate ${value} out of 5`}
            >
              ★
            </button>
          ))}
        </div>

        <textarea
          value={review}
          onChange={(event) => setReview(event.target.value)}
          maxLength={1000}
          placeholder="Write a review (optional)"
          className="mt-4 min-h-[100px] w-full resize-none rounded-md border border-white/10 bg-[#101010] p-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-white/30"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submitReview}
            disabled={saving}
            className="rounded-md bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : data.currentUserReview
              ? "Update Review"
              : "Submit Review"}
          </button>

          {data.currentUserReview && (
            <button
              type="button"
              onClick={deleteReview}
              className="text-sm text-gray-500 transition hover:text-white"
            >
              Delete
            </button>
          )}

          {message && (
            <span className="text-sm text-gray-500">
              {message}
            </span>
          )}
        </div>
      </div>

      {/* Reviews */}
      {data.reviews.length > 0 && (
        <div className="mt-6 space-y-4">
          {data.reviews.map((item) => (
            <div
              key={item.id}
              className="border-b border-white/10 pb-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">
                    {item.user.name}
                  </p>

                  <div className="mt-1 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <span
                        key={value}
                        className={
                          value <= item.rating
                            ? "text-yellow-400"
                            : "text-gray-700"
                        }
                      >
                        ★
                      </span>
                    ))}
                  </div>
                </div>

                <span className="text-xs text-gray-600">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>

              {item.review && (
                <p className="mt-3 text-sm leading-6 text-gray-400">
                  {item.review}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}