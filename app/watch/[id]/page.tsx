"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Hls from "hls.js";

export default function WatchPage() {
  const videoRef =
    useRef<HTMLVideoElement>(null);

  const hlsRef =
    useRef<Hls | null>(null);

  const params = useParams();
  const id = params.id as string;

  const [qualities, setQualities] =
    useState<string[]>([]);

  const [currentQuality, setCurrentQuality] =
    useState("Auto");

  const [subtitles, setSubtitles] =
    useState<
      {
        id: string;
        language: string;
        label: string;
        filePath: string;
        updatedAt: string;
      }[]
    >([]);

  const [selectedSubtitle, setSelectedSubtitle] =
    useState("off");

  // Audio tracks are discovered automatically from the HLS master manifest.
  // No manual audio upload is required.
  const [audioTracks, setAudioTracks] = useState<
    { id: number; label: string; language?: string }[]
  >([]);

  const [currentAudioTrack, setCurrentAudioTrack] =
    useState<number>(-1);

  const [showAudioMenu, setShowAudioMenu] =
    useState(false);

  // OTT player UI state
  const playerRef =
    useRef<HTMLDivElement>(null);

  const controlsTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] =
    useState(false);

  const [isBuffering, setIsBuffering] =
    useState(false);

  const [showControls, setShowControls] =
    useState(true);

  const [currentTime, setCurrentTime] =
    useState(0);

  const [duration, setDuration] =
    useState(0);

  const [bufferedEnd, setBufferedEnd] =
    useState(0);

  const [volume, setVolume] =
    useState(1);

  const [isMuted, setIsMuted] =
    useState(false);

  const [isFullscreen, setIsFullscreen] =
    useState(false);

  const [showSettings, setShowSettings] =
    useState(false);

  const [showSubtitlesMenu, setShowSubtitlesMenu] =
    useState(false);

  const [playbackRate, setPlaybackRate] =
    useState(1);

  const [showResumeBadge, setShowResumeBadge] =
    useState(false);

  // Authentication
  const [authenticated, setAuthenticated] =
    useState(false);

  const [checkingAuth, setCheckingAuth] =
    useState(true);

  // Video status
  const [videoStatus, setVideoStatus] =
    useState<string | null>(null);

  const [videoTitle, setVideoTitle] =
    useState("");

  const [checkingStatus, setCheckingStatus] =
    useState(true);

  const [statusError, setStatusError] =
    useState<string | null>(null);

  /*
   * Continue Watching
   *
   * Keep the latest playback values in refs
   * so we can save them without causing
   * unnecessary React re-renders.
   */
  const lastSavedPosition =
    useRef(0);

  const lastSaveTime =
    useRef(0);

  const durationRef =
    useRef<number | null>(null);

  const progressLoaded =
    useRef(false);

  /*
   * Check whether the viewer is logged in.
   */
  async function checkAuthentication() {
    try {
      const response = await fetch(
        "/api/auth/me",
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        setAuthenticated(false);
        return;
      }

      const data =
        await response.json();

      setAuthenticated(
        data.authenticated === true
      );
    } catch (error) {
      console.error(
        "Authentication check error:",
        error
      );

      setAuthenticated(false);
    } finally {
      setCheckingAuth(false);
    }
  }

  /*
   * Check the current video status
   * and viewer availability.
   */
  async function checkVideoStatus() {
    try {
      const response = await fetch(
        `/api/videos/${id}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Unable to load video information."
        );
      }

      const data =
        await response.json();

      setVideoTitle(
        data.title || ""
      );

      /*
       * A video is playable for viewers only when:
       *
       * 1. Processing is complete
       * 2. Admin has published it
       * 3. A playable stream exists
       */
      if (
        data.status === "READY" &&
        data.published === true &&
        Boolean(data.streamPath)
      ) {
        setVideoStatus("READY");
      } else if (
        data.status === "UPLOADING"
      ) {
        setVideoStatus("UPLOADING");
      } else if (
        data.status === "PROCESSING"
      ) {
        setVideoStatus("PROCESSING");
      } else if (
        data.status === "FAILED"
      ) {
        setVideoStatus("FAILED");
      } else {
        setVideoStatus("UNAVAILABLE");
      }

      return data;
    } catch (error) {
      console.error(
        "Video status error:",
        error
      );

      setStatusError(
        "Unable to check video status."
      );

      return null;
    } finally {
      setCheckingStatus(false);
    }
  }

  /*
   * Load previously saved playback
   * position for this user/video.
   */
  async function loadWatchProgress() {
    if (
      !authenticated ||
      !id ||
      progressLoaded.current
    ) {
      return;
    }

    try {
      const response =
        await fetch(
          `/api/watch-progress?videoId=${encodeURIComponent(
            id
          )}`,
          {
            cache: "no-store",
          }
        );

      if (!response.ok) {
        /*
         * A missing progress record is
         * perfectly normal for a new video.
         */
        if (response.status !== 401) {
          console.error(
            "Failed to load watch progress:",
            response.status
          );
        }

        return;
      }

      const progress =
        await response.json();

      /*
       * Mark as loaded even when there
       * is no previous progress.
       */
      progressLoaded.current = true;

      if (
        !progress ||
        progress.completed
      ) {
        return;
      }

      const savedPosition =
        Number(
          progress.positionSeconds
        );

      if (
        !Number.isFinite(
          savedPosition
        ) ||
        savedPosition <= 0
      ) {
        return;
      }

      const video =
        videoRef.current;

      if (!video) {
        return;
      }

      /*
       * Store the position for use when
       * metadata becomes available.
       */
      lastSavedPosition.current =
        savedPosition;

      /*
       * If duration is already available,
       * resume immediately.
       */
      if (
        Number.isFinite(
          video.duration
        ) &&
        video.duration > 0
      ) {
        /*
         * Keep a small safety gap from
         * the very end of the video.
         */
        const safePosition =
          Math.min(
            savedPosition,
            Math.max(
              0,
              video.duration - 1
            )
          );

        video.currentTime =
          safePosition;
      }
    } catch (error) {
      console.error(
        "Load watch progress error:",
        error
      );
    }
  }

  /*
   * Save the current playback position.
   */
  async function saveWatchProgress(
    force = false
  ) {
    if (
      !authenticated ||
      !id
    ) {
      return;
    }

    const video =
      videoRef.current;

    if (!video) {
      return;
    }

    const position =
      video.currentTime;

    const duration =
      video.duration;

    if (
      !Number.isFinite(position) ||
      position < 0
    ) {
      return;
    }

    const validDuration =
      Number.isFinite(duration) &&
      duration > 0
        ? duration
        : null;

    /*
     * Don't repeatedly send the same
     * position to the server.
     *
     * Normal saves happen at most once
     * every 10 seconds.
     */
    const now = Date.now();

    if (
      !force &&
      now - lastSaveTime.current <
        10000
    ) {
      return;
    }

    if (
      !force &&
      Math.abs(
        position -
          lastSavedPosition.current
      ) < 2
    ) {
      return;
    }

    /*
     * Optimistically update these refs
     * before the request.
     */
    lastSavedPosition.current =
      position;

    lastSaveTime.current =
      now;

    try {
      const response =
        await fetch(
          "/api/watch-progress",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              videoId: id,
              positionSeconds:
                position,
              durationSeconds:
                validDuration,
            }),
            keepalive: force,
          }
        );

      if (!response.ok) {
        console.error(
          "Failed to save watch progress:",
          response.status
        );
      }
    } catch (error) {
      console.error(
        "Save watch progress error:",
        error
      );
    }
  }
  /*
   * Check authentication when the page loads.
   */
  useEffect(() => {
    checkAuthentication();
  }, []);

  /*
   * Load subtitles for this video and keep the list live.
   *
   * The admin can upload/delete/replace subtitles while this
   * watch page is already open, so we refresh the subtitle list
   * every 3 seconds.
   */
  useEffect(() => {
    if (!id || !authenticated || videoStatus !== "READY") {
      return;
    }

    let cancelled = false;

    async function loadSubtitles() {
      try {
        const response = await fetch(
          `/api/videos/${id}/subtitles`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          if (!cancelled) {
            setSubtitles([]);
            setSelectedSubtitle("off");
          }
          return;
        }

        const data = await response.json();
        const nextSubtitles = Array.isArray(data) ? data : [];

        if (!cancelled) {
          setSubtitles(nextSubtitles);

          // If the currently selected language was deleted,
          // immediately turn subtitles off.
          setSelectedSubtitle((current) => {
            if (
              current !== "off" &&
              !nextSubtitles.some(
                (subtitle) => subtitle.language === current
              )
            ) {
              return "off";
            }

            return current;
          });
        }
      } catch (error) {
        console.warn("Subtitle loading error:", error);
      }
    }

    void loadSubtitles();

    const interval = window.setInterval(() => {
      if (!cancelled) {
        void loadSubtitles();
      }
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [id, authenticated, videoStatus]);

  /*
   * React immediately when the admin changes subtitles in
   * another tab. Polling below remains as a fallback.
   */
  useEffect(() => {
    if (!id || !authenticated || videoStatus !== "READY") {
      return;
    }

    async function refreshSubtitles() {
      try {
        const response = await fetch(
          `/api/videos/${id}/subtitles`,
          { cache: "no-store" }
        );

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        const nextSubtitles = Array.isArray(data) ? data : [];
        setSubtitles(nextSubtitles);

        setSelectedSubtitle((current) => {
          if (
            current !== "off" &&
            !nextSubtitles.some(
              (subtitle) => subtitle.language === current
            )
          ) {
            return "off";
          }

          return current;
        });
      } catch {
        // The normal polling effect will retry.
      }
    }

    let channel: BroadcastChannel | null = null;

    try {
      channel = new BroadcastChannel("streamflix-subtitles");
      channel.onmessage = (event) => {
        if (event.data?.type === "SUBTITLES_CHANGED" && event.data.videoId === id) {
          void refreshSubtitles();
        }
      };
    } catch {
      channel = null;
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== "streamflix_subtitles_changed" || !event.newValue) {
        return;
      }

      try {
        const data = JSON.parse(event.newValue);
        if (data?.videoId === id) {
          void refreshSubtitles();
        }
      } catch {
        // Ignore malformed storage events.
      }
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      channel?.close();
      window.removeEventListener("storage", handleStorage);
    };
  }, [id, authenticated, videoStatus]);

  /*
   * Enable only the selected subtitle track.
   */
  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    for (let index = 0; index < video.textTracks.length; index++) {
      const track = video.textTracks[index];

      if (selectedSubtitle === "off") {
        track.mode = "disabled";
      } else {
        track.mode =
          track.language === selectedSubtitle
            ? "showing"
            : "disabled";
      }
    }
  }, [selectedSubtitle, subtitles]);

  /*
   * Listen for logout events from other tabs.
   *
   * If the user logs out in another tab,
   * immediately stop playback here.
   */
  useEffect(() => {
    function handleLogout() {
      console.log(
        "Logout detected in another tab."
      );

      /*
       * Save is intentionally NOT attempted
       * here because the session has already
       * been removed.
       */
      setAuthenticated(false);

      /*
       * Stop HLS immediately.
       */
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      /*
       * Stop the HTML video element.
       */
      const video =
        videoRef.current;

      if (video) {
        video.pause();
        video.removeAttribute(
          "src"
        );
        video.load();
      }

      /*
       * Clear quality information.
       */
      setQualities([]);
      setCurrentQuality("Auto");
      setAudioTracks([]);
      setCurrentAudioTrack(-1);
      setShowAudioMenu(false);
    }

    /*
     * Modern browsers.
     */
    let channel:
      BroadcastChannel | null = null;

    try {
      channel =
        new BroadcastChannel(
          "streamflix-auth"
        );

      channel.onmessage = (
        event
      ) => {
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
     * Fallback using localStorage.
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
      channel?.close();

      window.removeEventListener(
        "storage",
        handleStorage
      );
    };
  }, []);

  /*
   * Check video status.
   *
   * If the video is processing,
   * continue checking every 3 seconds.
   */
  useEffect(() => {
    if (!id) return;

    let interval:
      ReturnType<typeof setInterval> | null =
      null;

    async function initialize() {
      const data =
        await checkVideoStatus();

      if (!data) {
        return;
      }

      if (
        data.status === "READY" &&
        data.published === true &&
        Boolean(data.streamPath)
      ) {
        return;
      }

      if (
        data.status === "PROCESSING"
      ) {
        interval =
          setInterval(
            async () => {
              const updated =
                await checkVideoStatus();

              if (!updated) {
                return;
              }

              if (
                updated.status ===
                  "READY" ||
                updated.status ===
                  "FAILED"
              ) {
                if (interval) {
                  clearInterval(
                    interval
                  );
                  interval = null;
                }
              }
            },
            3000
          );
      }
    }

    initialize();

    return () => {
      if (interval) {
        clearInterval(
          interval
        );
      }
    };
  }, [id]);

  /*
   * Load saved progress after
   * authentication has been confirmed.
   */
  useEffect(() => {
    console.log("HLS CHECK:", {
  authenticated,
  checkingAuth,
  videoStatus,
  id,
});
    if (
      !authenticated ||
      checkingAuth ||
      videoStatus !== "READY"
    ) {
      return;
    }

    progressLoaded.current =
      false;

    loadWatchProgress();
  }, [
    authenticated,
    checkingAuth,
    videoStatus,
    id,
  ]);

  /*
   * Initialize HLS ONLY after:
   *
   * 1. Authentication is confirmed
   * 2. Video is READY
   */
  useEffect(() => {
    if (
      !authenticated ||
      checkingAuth ||
      videoStatus !== "READY"
    ) {
      return;
    }

    const video =
      videoRef.current;

    if (!video || !id) {
      return;
    }

    /*
     * IMPORTANT:
     *
     * All HLS requests go through:
     *
     * /api/stream/<id>/...
     */
    const streamUrl =
      `/api/stream/${id}/master.m3u8`;

    let hls: Hls | null = null;

    /*
     * Resume once video metadata is
     * available.
     */
    const resumePlayback = () => {
      const savedPosition =
        lastSavedPosition.current;

      if (
        savedPosition <= 0
      ) {
        return;
      }

      if (
        !Number.isFinite(
          video.duration
        ) ||
        video.duration <= 0
      ) {
        return;
      }

      /*
       * Don't resume at the final second.
       */
      const safePosition =
        Math.min(
          savedPosition,
          Math.max(
            0,
            video.duration - 1
          )
        );

      /*
       * Only apply the position once.
       */
      if (
        Math.abs(
          video.currentTime -
            safePosition
        ) > 1
      ) {
        video.currentTime =
          safePosition;
      }

      progressLoaded.current =
        true;
    };

    video.addEventListener(
      "loadedmetadata",
      resumePlayback
    );

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
      });

      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(
        Hls.Events.AUDIO_TRACKS_UPDATED,
        (_event, data) => {
          const detectedAudioTracks =
            (data.audioTracks || []).map(
              (track, index) => ({
                id: index,
                label:
                  track.lang
                    ? track.lang.toUpperCase()
                    : track.name ||
                      `Audio ${index + 1}`,
                language:
                  track.lang || undefined,
              })
            );

          setAudioTracks(
            detectedAudioTracks
          );

          setCurrentAudioTrack(
            typeof hls!.audioTrack === "number"
              ? hls!.audioTrack
              : -1
          );
        }
      );

      hls.on(
        Hls.Events.AUDIO_TRACK_SWITCHED,
        (_event, data) => {
          setCurrentAudioTrack(
            typeof data.id === "number"
              ? data.id
              : hls!.audioTrack
          );
        }
      );

      hls.on(
        Hls.Events.MANIFEST_PARSED,
        () => {
          console.log(
            "Authenticated HLS manifest loaded"
          );

          const levels =
            hls!.levels;

          const detectedQualities:
            string[] = [];

          levels.forEach(
            (level) => {
              /*
               * Prefer the generated HLS variant path.
               * This is important for cinematic sources such as
               * 1280x544: the 720p rendition is still the 720p
               * quality tier even though its actual HLS height is 544.
               */
              const levelUrl =
                typeof level.url === "string"
                  ? level.url
                  : "";

              const pathMatch =
                levelUrl.match(
                  /\/(1080p|720p|480p|360p)\/playlist\.m3u8(?:[?#].*)?$/i
                );

              if (pathMatch) {
                detectedQualities.push(
                  pathMatch[1].toLowerCase()
                );
                return;
              }

              /*
               * Fallback for HLS configurations where the level URL
               * is not exposed. Use the actual encoded height.
               */
              const height =
                level.height;

              if (!height) return;

              if (height >= 1000) {
                detectedQualities.push(
                  "1080p"
                );
              } else if (
                height >= 700
              ) {
                detectedQualities.push(
                  "720p"
                );
              } else if (
                height >= 450
              ) {
                detectedQualities.push(
                  "480p"
                );
              } else if (
                height >= 300
              ) {
                detectedQualities.push(
                  "360p"
                );
              }
            }
          );

          /*
           * Remove duplicates and sort
           * highest → lowest.
           */
          const sortedQualities = [
            ...new Set(
              detectedQualities
            ),
          ].sort(
            (a, b) =>
              Number(
                b.replace("p", "")
              ) -
              Number(
                a.replace("p", "")
              )
          );

          setQualities(
            sortedQualities
          );

          /*
           * Try to resume after the
           * manifest is ready.
           */
          resumePlayback();

          video
            .play()
            .catch(() => {});
        }
      );

      hls.on(
        Hls.Events.ERROR,
        (_event, data) => {
          /*
           * HLS can emit recoverable ERROR events during
           * normal playback. Do not use console.error here,
           * because Next.js treats console errors as application
           * errors and can show the red error overlay.
           *
           * Only act on fatal errors.
           */
          if (!data.fatal) {
            return;
          }

          if (
            data.type ===
            Hls.ErrorTypes.NETWORK_ERROR
          ) {
            console.warn(
              "Recovering from fatal HLS network error:",
              data.details
            );

            hls?.startLoad();
            return;
          }

          if (
            data.type ===
            Hls.ErrorTypes.MEDIA_ERROR
          ) {
            console.warn(
              "Recovering from fatal HLS media error:",
              data.details
            );

            hls?.recoverMediaError();
            return;
          }

          /*
           * Unknown fatal HLS errors are still reported,
           * but as a warning so they do not trigger the
           * Next.js console error overlay.
           */
          console.warn(
            "Unrecoverable HLS error:",
            data.type,
            data.details
          );
        }
      );
    } else if (
      video.canPlayType(
        "application/vnd.apple.mpegurl"
      )
    ) {
      /*
       * Safari/native HLS.
       */
      video.src = streamUrl;

      const handleLoadedMetadata =
        () => {
          resumePlayback();

          video
            .play()
            .catch(() => {});
        };

      video.addEventListener(
        "loadedmetadata",
        handleLoadedMetadata
      );

      return () => {
        video.removeEventListener(
          "loadedmetadata",
          handleLoadedMetadata
        );

        video.removeAttribute(
          "src"
        );

        video.load();
      };
    }

    return () => {
      video.removeEventListener(
        "loadedmetadata",
        resumePlayback
      );

      hls?.destroy();
      hlsRef.current = null;
    };
  }, [
    videoStatus,
    authenticated,
    checkingAuth,
    id,
  ]);

  /*
   * Track playback progress.
   *
   * timeupdate fires frequently, but
   * saveWatchProgress() limits actual
   * network saves to approximately
   * once every 10 seconds.
   */
  useEffect(() => {
    if (
      !authenticated ||
      videoStatus !== "READY"
    ) {
      return;
    }

    const video =
      videoRef.current;

    if (!video) {
      return;
    }

    function handleTimeUpdate() {
      if (
        Number.isFinite(
          video!.duration
        ) &&
        video!.duration > 0
      ) {
        durationRef.current =
          video!.duration;
      }

      saveWatchProgress(
        false
      );
    }

    function handlePause() {
      saveWatchProgress(
        true
      );
    }

    function handleEnded() {
      /*
       * This sends the final position.
       * The API will mark the video
       * completed because it is >= 90%.
       */
      saveWatchProgress(
        true
      );
    }

    video.addEventListener(
      "timeupdate",
      handleTimeUpdate
    );

    video.addEventListener(
      "pause",
      handlePause
    );

    video.addEventListener(
      "ended",
      handleEnded
    );

    return () => {
      video.removeEventListener(
        "timeupdate",
        handleTimeUpdate
      );

      video.removeEventListener(
        "pause",
        handlePause
      );

      video.removeEventListener(
        "ended",
        handleEnded
      );
    };
  }, [
    authenticated,
    videoStatus,
    id,
  ]);

  /*
   * Save progress when the viewer
   * leaves the page.
   */
  useEffect(() => {
    if (
      !authenticated ||
      videoStatus !== "READY"
    ) {
      return;
    }

    function handlePageHide() {
      saveWatchProgress(
        true
      );
    }

    window.addEventListener(
      "pagehide",
      handlePageHide
    );

    return () => {
      window.removeEventListener(
        "pagehide",
        handlePageHide
      );
    };
  }, [
    authenticated,
    videoStatus,
    id,
  ]);

  /*
   * Keep custom OTT controls synchronized with the native video element.
   */
  useEffect(() => {
    if (!authenticated || videoStatus !== "READY") return;

    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => {
      setCurrentTime(video.currentTime || 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);

      if (video.buffered.length > 0) {
        try {
          setBufferedEnd(video.buffered.end(video.buffered.length - 1));
        } catch {
          setBufferedEnd(0);
        }
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      revealControls(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      revealControls(false);
    };

    const handleWaiting = () => {
      if (!video.paused) setIsBuffering(true);
      revealControls(false);
    };

    const handlePlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };

    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setIsMuted(video.muted);
      updateTime();

      if (lastSavedPosition.current > 0) {
        setShowResumeBadge(true);
        window.setTimeout(() => setShowResumeBadge(false), 5000);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      setShowControls(true);
      clearControlsTimer();
    };

    const handleProgress = () => updateTime();

    video.addEventListener("timeupdate", updateTime);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("stalled", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("ended", handleEnded);

    return () => {
      clearControlsTimer();
      video.removeEventListener("timeupdate", updateTime);
      video.removeEventListener("progress", handleProgress);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("ended", handleEnded);
    };
  }, [authenticated, videoStatus]);

  /*
   * Fullscreen state and keyboard shortcuts.
   */
  useEffect(() => {
    if (!authenticated || videoStatus !== "READY") return;

    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;

      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-10);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(10);
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMute();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === "Escape") {
        setShowSettings(false);
        setShowSubtitlesMenu(false);
        setShowAudioMenu(false);
      }

      revealControls(false);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [authenticated, videoStatus, isPlaying, volume]);

  /*
   * Change video quality.
   */
  function changeQuality(
    quality: string
  ) {
    const hls =
      hlsRef.current;

    if (!hls) return;

    setCurrentQuality(
      quality
    );

    if (quality === "Auto") {
      hls.nextLevel = -1;
      return;
    }

    const qualityPattern =
      new RegExp(
        `\\/${quality}\\/playlist\\.m3u8(?:[?#].*)?$`,
        "i"
      );

    let levelIndex =
      hls.levels.findIndex(
        (level) =>
          typeof level.url === "string" &&
          qualityPattern.test(level.url)
      );

    /*
     * Fallback for HLS.js configurations where level.url
     * is unavailable. This keeps the normal 16:9 case working.
     */
    if (levelIndex === -1) {
      const height =
        Number(
          quality.replace(
            "p",
            ""
          )
        );

      levelIndex =
        hls.levels.findIndex(
          (level) =>
            level.height ===
            height
        );
    }

    if (levelIndex === -1) {
      return;
    }

    /*
     * Switch on the next suitable segment.
     *
     * Do NOT manually change currentTime.
     */
    hls.nextLevel =
      levelIndex;
  }

  /*
   * Change the active HLS audio track.
   */
  function changeAudioTrack(
    trackId: number
  ) {
    const hls =
      hlsRef.current;

    if (!hls) return;

    if (
      trackId < 0 ||
      trackId >= hls.audioTracks.length
    ) {
      return;
    }

    hls.audioTrack =
      trackId;

    setCurrentAudioTrack(
      trackId
    );

    setShowAudioMenu(false);
    revealControls(false);
  }

  /*
   * OTT player helpers.
   */
  function clearControlsTimer() {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
  }

  function revealControls(autoHide = true) {
    setShowControls(true);
    clearControlsTimer();

    if (autoHide && isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
        setShowSettings(false);
        setShowSubtitlesMenu(false);
        setShowAudioMenu(false);
      }, 3000);
    }
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }

    revealControls(false);
  }

  function seekBy(seconds: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;

    video.currentTime = Math.min(
      Math.max(0, video.currentTime + seconds),
      video.duration
    );

    setCurrentTime(video.currentTime);
    revealControls(false);
    void saveWatchProgress(true);
  }

  function seekToPercent(percent: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;

    const nextTime = Math.min(1, Math.max(0, percent)) * video.duration;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    revealControls(false);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;

    if (video.muted) {
      video.muted = false;
      setIsMuted(false);
      if (video.volume === 0) {
        video.volume = volume > 0 ? volume : 1;
        setVolume(video.volume);
      }
    } else {
      video.muted = true;
      setIsMuted(true);
    }

    revealControls(false);
  }

  function changeVolume(nextVolume: number) {
    const video = videoRef.current;
    if (!video) return;

    const next = Math.min(1, Math.max(0, nextVolume));
    video.volume = next;
    video.muted = next === 0;
    setVolume(next);
    setIsMuted(next === 0);
  }

  async function toggleFullscreen() {
    const player = playerRef.current;
    if (!player) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await player.requestFullscreen();
      }
    } catch {
      // Fullscreen can be rejected by browser policy.
    }
  }

  async function togglePictureInPicture() {
    const video = videoRef.current as (HTMLVideoElement & {
      requestPictureInPicture?: () => Promise<unknown>;
    }) | null;

    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch {
      // Picture-in-picture is not available in every browser.
    }
  }

  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function changePlaybackRate(rate: number) {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSettings(false);
    revealControls(false);
  }

  /*
   * Authentication loading.
   */
  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="text-center">

          <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />

          <h1 className="text-xl font-semibold">
            Checking your account...
          </h1>

          <p className="mt-2 text-sm text-white/50">
            Please wait
          </p>

        </div>
      </main>
    );
  }

  /*
   * Viewer is not authenticated.
   */
  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="max-w-md text-center">

          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
            <span className="text-3xl">
              🔒
            </span>
          </div>

          <h1 className="text-2xl font-semibold">
            Sign in to watch
          </h1>

          <p className="mt-3 text-white/60">
            Please sign in to your
            STREAMFLIX account to
            continue watching.
          </p>

          <Link
            href="/login"
            className="mt-7 inline-block rounded-md bg-red-600 px-7 py-3 font-semibold text-white transition hover:bg-red-700"
          >
            Sign In
          </Link>

          <p className="mt-5 text-sm text-white/40">
            Don't have an account?{" "}
            <Link
              href="/signup"
              className="text-white hover:underline"
            >
              Sign up
            </Link>
          </p>

        </div>

      </main>
    );
  }

  /*
   * Loading video status.
   */
  if (checkingStatus) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="text-center">

          <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />

          <h1 className="text-xl font-semibold">
            Loading video...
          </h1>

          <p className="mt-2 text-sm text-white/50">
            Checking video status
          </p>

        </div>

      </main>
    );
  }

  /*
   * API/status error.
   */
  if (statusError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="max-w-md text-center">

          <h1 className="text-2xl font-semibold">
            Unable to load video
          </h1>

          <p className="mt-3 text-sm text-white/60">
            {statusError}
          </p>

        </div>

      </main>
    );
  }

  /*
   * Video is still uploading.
   */
  if (
    videoStatus === "UPLOADING"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="max-w-md text-center">

          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          </div>

          <h1 className="text-2xl font-semibold">
            Video upload is still in
            progress
          </h1>

          <p className="mt-3 text-white/60">
            {videoTitle ||
              "Your video"}
          </p>

          <p className="mt-4 text-sm leading-6 text-white/50">
            Please wait until the
            upload is complete. The
            video will be available
            for streaming after
            processing finishes.
          </p>

          <div className="mt-8 rounded-lg border border-white/10 bg-white/5 p-4">

            <div className="flex items-center justify-between text-sm">

              <span className="text-white/50">
                Status
              </span>

              <span className="font-medium text-yellow-400">
                Uploading
              </span>

            </div>

          </div>

        </div>

      </main>
    );
  }

  /*
   * Video is being processed.
   */
  if (
    videoStatus === "PROCESSING"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="w-full max-w-lg text-center">

          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          </div>

          <h1 className="text-2xl font-semibold">
            Video is being processed
          </h1>

          <p className="mt-3 text-white/60">
            {videoTitle ||
              "Your video"}
          </p>

          <p className="mt-4 text-sm leading-6 text-white/50">
            We are preparing this
            video for streaming in
            multiple quality levels.
            The player will become
            available automatically
            when processing is
            complete.
          </p>

          <div className="mt-8 rounded-lg border border-white/10 bg-white/5 p-4">

            <div className="flex items-center justify-between text-sm">

              <span className="text-white/50">
                Status
              </span>

              <span className="font-medium text-yellow-400">
                Processing
              </span>

            </div>

          </div>

          <p className="mt-4 text-xs text-white/30">
            This page checks
            automatically for
            completion.
          </p>

        </div>

      </main>
    );
  }

  /*
   * Processing failed.
   */
  if (
    videoStatus === "FAILED"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="max-w-md text-center">

          <h1 className="text-2xl font-semibold">
            Video processing failed
          </h1>

          <p className="mt-3 text-white/60">
            {videoTitle ||
              "This video"}{" "}
            could not be prepared
            for streaming.
          </p>

          <p className="mt-4 text-sm text-white/40">
            Please try processing
            the video again.
          </p>

        </div>

      </main>
    );
  }

  /*
   * Video is unpublished or otherwise
   * unavailable.
   */
  if (
    videoStatus === "UNAVAILABLE"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">

        <div className="max-w-md text-center">

          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
            <span className="text-3xl">
              🔒
            </span>
          </div>

          <h1 className="text-2xl font-semibold">
            Video unavailable
          </h1>

          <p className="mt-3 text-white/60">
            {videoTitle ||
              "This video"}{" "}
            is currently unavailable.
          </p>

          <p className="mt-4 text-sm text-white/40">
            This title may have been
            unpublished or removed.
          </p>

        </div>

      </main>
    );
  }

  /*
   * READY
   *
   * Only now do we render the
   * video player.
   */
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const bufferedPercent =
    duration > 0 ? Math.min(100, Math.max(0, (bufferedEnd / duration) * 100)) : 0;

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col">
        <header className="flex h-16 items-center justify-between border-b border-white/10 bg-black/70 px-4 backdrop-blur-xl sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-3 text-sm font-medium text-white/70 transition hover:text-white"
          >
            <span className="text-xl">←</span>
            <span className="hidden sm:inline">Back to browse</span>
          </Link>

          <div className="max-w-[55%] truncate text-center text-sm font-semibold sm:text-base">
            {videoTitle || "Now Playing"}
          </div>

          <div className="w-20 sm:w-28" />
        </header>

        <section className="flex flex-1 flex-col">
          <div
            ref={playerRef}
            className={`group relative w-full overflow-hidden bg-black ${
              isFullscreen ? "h-screen" : "aspect-video max-h-[78vh]"
            }`}
            onMouseMove={() => revealControls(true)}
            onMouseLeave={() => {
              if (isPlaying) {
                clearControlsTimer();
                controlsTimeoutRef.current = setTimeout(() => {
                  setShowControls(false);
                  setShowSettings(false);
                  setShowSubtitlesMenu(false);
                }, 1500);
              }
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) togglePlayback();
            }}
            onDoubleClick={() => void toggleFullscreen()}
          >
            <video aria-label="Video player"
              ref={videoRef}
              playsInline
              preload="auto"
              className="h-full w-full object-contain"
              onClick={(event) => {
                event.stopPropagation();
                togglePlayback();
              }}
            >
              {subtitles.map((subtitle) => {
                const subtitleSrc =
                  `${subtitle.filePath}${
                    subtitle.filePath.includes("?") ? "&" : "?"
                  }v=${encodeURIComponent(subtitle.updatedAt)}`;

                return (
                  <track
                    key={`${subtitle.id}-${subtitle.updatedAt}`}
                    kind="subtitles"
                    src={subtitleSrc}
                    srcLang={subtitle.language}
                    label={subtitle.label}
                  />
                );
              })}
            </video>

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/80" />

            <div className="pointer-events-none absolute left-5 top-5 max-w-[70%] sm:left-8 sm:top-7">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-white/60">
                Now playing
              </div>
              <h1 className="mt-1 truncate text-lg font-semibold drop-shadow-lg sm:text-2xl">
                {videoTitle || "Video"}
              </h1>
            </div>

            {showResumeBadge && lastSavedPosition.current > 0 && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/75 px-4 py-2 text-sm text-white/80 backdrop-blur-md">
                Resuming from {formatTime(lastSavedPosition.current)}
              </div>
            )}

            {isBuffering && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
              </div>
            )}

            {!isPlaying && !isBuffering && (
              <button
                type="button"
                aria-label="Play"
                onClick={togglePlayback}
                className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-2xl transition hover:scale-105 sm:h-20 sm:w-20"
              >
                <span className="ml-1 text-3xl">▶</span>
              </button>
            )}

            <div
              className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
                showControls ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <div className="px-4 pb-2 sm:px-6">
                <div
                  className="group/progress relative h-1.5 cursor-pointer rounded-full bg-white/25 transition-all hover:h-2.5"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekToPercent((event.clientX - rect.left) / rect.width);
                  }}
                >
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-white/20"
                    style={{ width: `${bufferedPercent}%` }}
                  />
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-red-600"
                    style={{ width: `${progressPercent}%` }}
                  />
                  <div
                    className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-red-600 opacity-0 shadow-lg transition-opacity group-hover/progress:opacity-100"
                    style={{ left: `calc(${progressPercent}% - 7px)` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-4 pb-4 sm:px-6 sm:pb-5">
                <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                  <button
                    type="button"
                    aria-label={isPlaying ? "Pause" : "Play"}
                    onClick={togglePlayback}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition hover:bg-white/15"
                  >
                    {isPlaying ? "❚❚" : "▶"}
                  </button>

                  <button
                    type="button"
                    aria-label="Rewind 10 seconds"
                    onClick={() => seekBy(-10)}
                    className="flex h-10 min-w-10 items-center justify-center rounded-full text-xs font-semibold transition hover:bg-white/15"
                  >
                    ↶10
                  </button>

                  <button
                    type="button"
                    aria-label="Forward 10 seconds"
                    onClick={() => seekBy(10)}
                    className="flex h-10 min-w-10 items-center justify-center rounded-full text-xs font-semibold transition hover:bg-white/15"
                  >
                    10↷
                  </button>

                  <button
                    type="button"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                    onClick={toggleMute}
                    className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-lg transition hover:bg-white/15 active:scale-95"
                  >
                    {isMuted || volume === 0 ? "🔇" : "🔊"}
                  </button>

                  <div className="hidden w-24 items-center sm:flex">
                    <input
                      aria-label="Volume"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={isMuted ? 0 : volume}
                      onChange={(event) => changeVolume(Number(event.target.value))}
                      className="w-full accent-white"
                    />
                  </div>

                  <span className="ml-1 whitespace-nowrap text-xs text-white/70 sm:text-sm">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="relative flex shrink-0 items-center gap-1 sm:gap-2">
                  {audioTracks.length > 1 && (
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Audio tracks"
                        aria-expanded={showAudioMenu}
                        onClick={() => {
                          setShowAudioMenu((current) => !current);
                          setShowSettings(false);
                          setShowSubtitlesMenu(false);
                          revealControls(false);
                        }}
                        className={`flex h-11 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition hover:bg-white/15 sm:px-3 sm:text-sm ${
                          showAudioMenu ? "bg-white/15" : ""
                        }`}
                      >
                        A
                      </button>

                      {showAudioMenu && (
                        <div className="absolute bottom-12 right-0 w-56 rounded-xl border border-white/10 bg-[#171717]/95 p-2 shadow-2xl backdrop-blur-xl">
                          <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-white/40">
                            Audio
                          </div>

                          {audioTracks.map((track) => (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => changeAudioTrack(track.id)}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10 ${
                                currentAudioTrack === track.id
                                  ? "text-white"
                                  : "text-white/60"
                              }`}
                            >
                              <span className="truncate">
                                {track.label}
                              </span>
                              {currentAudioTrack === track.id && (
                                <span className="ml-3 shrink-0">✓</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {subtitles.length > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Subtitles"
                        aria-expanded={showSubtitlesMenu}
                        onClick={() => {
                          setShowSubtitlesMenu((current) => !current);
                          setShowSettings(false);
                          setShowAudioMenu(false);
                          revealControls(false);
                        }}
                        className={`flex h-10 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition hover:bg-white/15 sm:px-3 sm:text-sm ${
                          selectedSubtitle !== "off" ? "bg-white/15" : ""
                        }`}
                      >
                        CC
                      </button>

                      {showSubtitlesMenu && (
                        <div className="absolute bottom-12 right-0 w-48 rounded-xl border border-white/10 bg-[#171717]/95 p-2 shadow-2xl backdrop-blur-xl">
                          <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-white/40">
                            Subtitles
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSubtitle("off");
                              setShowSubtitlesMenu(false);
                              revealControls(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10 ${selectedSubtitle === "off" ? "text-white" : "text-white/60"}`}
                          >
                            Off
                            {selectedSubtitle === "off" && <span>✓</span>}
                          </button>
                          {subtitles.map((subtitle) => (
                            <button
                              key={subtitle.id}
                              type="button"
                              onClick={() => {
                                setSelectedSubtitle(subtitle.language);
                                setShowSubtitlesMenu(false);
                                revealControls(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10 ${selectedSubtitle === subtitle.language ? "text-white" : "text-white/60"}`}
                            >
                              {subtitle.label}
                              {selectedSubtitle === subtitle.language && <span>✓</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Player settings"
                      aria-expanded={showSettings}
                      onClick={() => {
                        setShowSettings((current) => !current);
                        setShowSubtitlesMenu(false);
                        setShowAudioMenu(false);
                        revealControls(false);
                      }}
                      className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-lg transition hover:bg-white/15 active:scale-95"
                    >
                      ⚙
                    </button>

                    {showSettings && (
                      <div className="absolute bottom-12 right-0 w-56 rounded-xl border border-white/10 bg-[#171717]/95 p-2 shadow-2xl backdrop-blur-xl">
                        {qualities.length > 0 && (
                          <div className="mb-2">
                            <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-white/40">
                              Quality
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                changeQuality("Auto");
                                setShowSettings(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10 ${currentQuality === "Auto" ? "text-white" : "text-white/60"}`}
                            >
                              Auto
                              {currentQuality === "Auto" && <span>✓</span>}
                            </button>
                            {qualities.map((quality) => (
                              <button
                                key={quality}
                                type="button"
                                onClick={() => {
                                  changeQuality(quality);
                                  setShowSettings(false);
                                }}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10 ${currentQuality === quality ? "text-white" : "text-white/60"}`}
                              >
                                {quality}
                                {currentQuality === quality && <span>✓</span>}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="border-t border-white/10 pt-2">
                          <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-white/40">
                            Playback speed
                          </div>
                          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                              key={rate}
                              type="button"
                              onClick={() => changePlaybackRate(rate)}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10 ${playbackRate === rate ? "text-white" : "text-white/60"}`}
                            >
                              {rate === 1 ? "Normal" : `${rate}x`}
                              {playbackRate === rate && <span>✓</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label="Picture in picture"
                    onClick={() => void togglePictureInPicture()}
                    className="hidden h-10 w-10 items-center justify-center rounded-full text-sm transition hover:bg-white/15 md:flex"
                  >
                    ▣
                  </button>

                  <button
                    type="button"
                    aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    onClick={() => void toggleFullscreen()}
                    className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-lg transition hover:bg-white/15 active:scale-95"
                  >
                    {isFullscreen ? "⛶" : "⛶"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-white/10 bg-[#080808] px-5 py-6 sm:px-8 sm:py-8">
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                    Watching now
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                    {videoTitle || "Video"}
                  </h2>
                  <p className="mt-2 text-sm text-white/50">
                    Your progress is saved automatically so you can continue watching later.
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span className="rounded-full border border-white/10 px-3 py-1.5">
                    HLS streaming
                  </span>
                  {selectedSubtitle !== "off" && (
                    <span className="rounded-full border border-white/10 px-3 py-1.5">
                      {subtitles.find((item) => item.language === selectedSubtitle)?.label || "CC"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}