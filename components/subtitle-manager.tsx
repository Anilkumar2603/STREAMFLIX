"use client";

import { useEffect, useState } from "react";

type Subtitle = {
  id: string;
  language: string;
  label: string;
  filePath: string;
};

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "te", label: "Telugu" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
];

export default function SubtitleManager({ videoId }: { videoId: string }) {
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [language, setLanguage] = useState("en");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function loadSubtitles() {
    try {
      const response = await fetch(`/api/videos/${videoId}/subtitles`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load subtitles");
      const data = await response.json();
      setSubtitles(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Subtitle loading error:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSubtitles(); }, [videoId]);

  async function uploadSubtitle() {
    if (!file) { setMessage("Select a .vtt file first."); return; }
    if (!file.name.toLowerCase().endsWith(".vtt")) { setMessage("Only .vtt files are supported."); return; }
    setUploading(true); setMessage("");
    try {
      const formData = new FormData();
      formData.append("language", language);
      formData.append("file", file);
      const response = await fetch(`/api/videos/${videoId}/subtitles`, { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to upload subtitle.");
      setFile(null);
      const input = document.getElementById(`subtitle-file-${videoId}`) as HTMLInputElement | null;
      if (input) input.value = "";
      setMessage(`${result.label} subtitle uploaded successfully.`);
      await loadSubtitles();
      try {
        const channel = new BroadcastChannel("streamflix-subtitles");
        channel.postMessage({ type: "SUBTITLES_CHANGED", videoId });
        channel.close();
      } catch {
        // Use localStorage as a fallback for browsers without BroadcastChannel.
      }
      window.localStorage.setItem(
        "streamflix_subtitles_changed",
        JSON.stringify({ videoId, at: Date.now() })
      );
    } catch (error) {
      console.error("Subtitle upload error:", error);
      setMessage(error instanceof Error ? error.message : "Failed to upload subtitle.");
    } finally { setUploading(false); }
  }

  async function deleteSubtitle(subtitle: Subtitle) {
    if (!window.confirm(`Delete ${subtitle.label} subtitles?`)) return;
    setDeleting(subtitle.id); setMessage("");
    try {
      const response = await fetch(`/api/videos/${videoId}/subtitles?language=${encodeURIComponent(subtitle.language)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to delete subtitle.");
      setSubtitles((current) => current.filter((item) => item.id !== subtitle.id));
      setMessage(`${subtitle.label} subtitle deleted.`);
      try {
        const channel = new BroadcastChannel("streamflix-subtitles");
        channel.postMessage({ type: "SUBTITLES_CHANGED", videoId });
        channel.close();
      } catch {
        // Use localStorage as a fallback for browsers without BroadcastChannel.
      }
      window.localStorage.setItem(
        "streamflix_subtitles_changed",
        JSON.stringify({ videoId, at: Date.now() })
      );
    } catch (error) {
      console.error("Subtitle delete error:", error);
      setMessage(error instanceof Error ? error.message : "Failed to delete subtitle.");
    } finally { setDeleting(null); }
  }

  return (
    <div className="mt-6 rounded-xl border border-white/5 bg-black/20 p-4">
      <div className="mb-4">
        <p className="text-xs font-medium text-gray-500">Subtitles</p>
        <p className="mt-1 text-[11px] text-gray-700">Upload WebVTT (.vtt) subtitle files for this video.</p>
      </div>
      {loading ? <p className="text-xs text-gray-600">Loading subtitles...</p> : subtitles.length > 0 ? (
        <div className="space-y-2">
          {subtitles.map((subtitle) => (
            <div key={subtitle.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-white">{subtitle.label}</span>
                <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase text-gray-500">{subtitle.language}</span>
              </div>
              <button type="button" disabled={deleting === subtitle.id} onClick={() => deleteSubtitle(subtitle)} className="text-xs text-red-400 transition hover:text-red-300 disabled:opacity-50">
                {deleting === subtitle.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-gray-600">No subtitles added yet.</p>}
      <div className="mt-4 border-t border-white/5 pt-4">
        <div className="grid gap-3 md:grid-cols-[160px_1fr_auto]">
          <select value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/30">
            {LANGUAGES.map((item) => <option key={item.code} value={item.code} className="bg-[#151515]">{item.label}</option>)}
          </select>
          <input id={`subtitle-file-${videoId}`} type="file" accept=".vtt,text/vtt" onChange={(event) => setFile(event.target.files?.[0] || null)} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-white" />
          <button type="button" disabled={uploading || !file} onClick={uploadSubtitle} className="rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40">{uploading ? "Uploading..." : "Upload"}</button>
        </div>
        {message && <p className="mt-3 text-xs text-gray-500">{message}</p>}
      </div>
    </div>
  );
}
