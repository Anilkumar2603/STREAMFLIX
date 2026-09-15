"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_CONCURRENT = 4;
const MAX_RETRIES = 3;
const PROCESSING_POLL_INTERVAL = 3000;

type UploadStatus =
  | "idle"
  | "starting"
  | "resuming"
  | "uploading"
  | "processing"
  | "complete"
  | "cancelled"
  | "error";

interface UploadSession {
  videoId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
}

interface UploadStatusResponse {
  videoId: string;
  status: string;
  uploadedChunks: number[];
  storageMode: "local" | "r2";
}

interface VideoProcessingResponse {
  id: string;
  title: string;
  status: string;

  duration: number | null;
  thumbnailPath: string | null;
  streamPath: string | null;

  progress: number;
  processingFps: number | null;
  processingSpeed: number | null;
  processingElapsed: number | null;
  processingEta: number | null;
  processingStage: string | null;
  encoderUsed: string | null;
}

export default function UploadPage() {
  const [title, setTitle] = useState("");
  const [file, setFile] =
    useState<File | null>(null);
const [backgroundProcessing, setBackgroundProcessing] =
  useState<VideoProcessingResponse[]>([]);
  const [status, setStatus] =
    useState<UploadStatus>("idle");

  /*
   * Upload progress.
   */
  const [progress, setProgress] =
    useState(0);

  const [uploadedBytes, setUploadedBytes] =
    useState(0);

  const [speed, setSpeed] =
    useState(0);

  const [eta, setEta] =
    useState<number | null>(null);

  /*
   * Processing progress.
   *
   * These are separate from upload speed/ETA.
   */
  const [processingSpeed, setProcessingSpeed] =
    useState<number | null>(null);

  const [processingEta, setProcessingEta] =
    useState<number | null>(null);

  const [processingElapsed, setProcessingElapsed] =
    useState<number | null>(null);

  const [processingFps, setProcessingFps] =
    useState<number | null>(null);

  const [processingStage, setProcessingStage] =
    useState<string | null>(null);

  const [encoderUsed, setEncoderUsed] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const [videoId, setVideoId] =
    useState<string | null>(null);

  const [uploadedChunks, setUploadedChunks] =
    useState<number[]>([]);

  const [storageMode, setStorageMode] =
  useState<"local" | "r2">("local");

  const [dragging, setDragging] =
    useState(false);

  const cancelRef =
    useRef(false);

  const startTimeRef =
    useRef<number | null>(null);

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  function getFileKey(
    selectedFile: File
  ) {
    return `upload-session:${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`;
  }

  function formatBytes(
    bytes: number
  ) {
    if (
      !Number.isFinite(bytes) ||
      bytes <= 0
    ) {
      return "0 B";
    }

    const units = [
      "B",
      "KB",
      "MB",
      "GB",
      "TB",
    ];

    const index = Math.min(
      Math.floor(
        Math.log(bytes) /
          Math.log(1024)
      ),
      units.length - 1
    );

    return `${(
      bytes /
      Math.pow(1024, index)
    ).toFixed(
      index === 0 ? 0 : 2
    )} ${units[index]}`;
  }

  function formatTime(
    seconds: number | null
  ) {
    if (
      seconds === null ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return "--";
    }

    if (seconds < 60) {
      return `${Math.ceil(seconds)}s`;
    }

    const minutes = Math.floor(
      seconds / 60
    );

    const remainingSeconds =
      Math.ceil(seconds % 60);

    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(
      minutes / 60
    );

    const remainingMinutes =
      minutes % 60;

    return `${hours}h ${remainingMinutes}m`;
  }

  function calculateUploadedBytes(
    chunks: number[],
    fileSize: number
  ) {
    let bytes = 0;

    for (const chunkIndex of chunks) {
      const start =
        chunkIndex *
        CHUNK_SIZE;

      const end = Math.min(
        start + CHUNK_SIZE,
        fileSize
      );

      if (end > start) {
        bytes += end - start;
      }
    }

    return bytes;
  }

  function calculateStats(
    currentUploadedBytes: number,
    totalSize: number
  ) {
    if (!startTimeRef.current) {
      startTimeRef.current =
        Date.now();

      return;
    }

    const elapsed =
      (Date.now() -
        startTimeRef.current) /
      1000;

    if (elapsed <= 0) {
      return;
    }

    const currentSpeed =
      currentUploadedBytes /
      elapsed;

    setSpeed(currentSpeed);

    if (currentSpeed > 0) {
      const remaining =
        totalSize -
        currentUploadedBytes;

      setEta(
        remaining /
          currentSpeed
      );
    }
  }

  function resetProcessingStats() {
    setProcessingSpeed(null);
    setProcessingEta(null);
    setProcessingElapsed(null);
    setProcessingFps(null);
    setProcessingStage(null);
    setEncoderUsed(null);
  }

  // --------------------------------------------------
  // Server upload status
  // --------------------------------------------------

  async function getUploadStatus(
    existingVideoId: string
  ): Promise<UploadStatusResponse | null> {
    try {
      const response =
        await fetch(
          `/api/videos/upload/status?videoId=${encodeURIComponent(
            existingVideoId
          )}`,
          {
            cache: "no-store",
          }
        );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  // --------------------------------------------------
  // Video processing status
  // --------------------------------------------------

  async function getVideoProcessingStatus(
    existingVideoId: string
  ): Promise<VideoProcessingResponse | null> {
    try {
      const response =
        await fetch(
          `/api/videos/${encodeURIComponent(
            existingVideoId
          )}`,
          {
            cache: "no-store",
          }
        );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  // --------------------------------------------------
  // Processing polling
  // --------------------------------------------------
  
  useEffect(() => {
    if (
      status !== "processing" ||
      !videoId
    ) {
      return;
    }
    const currentVideoId=videoId;
    let cancelled = false;

    async function pollProcessingStatus() {
      try {
        const video =
          await getVideoProcessingStatus(
           currentVideoId
          );

        if (
          cancelled ||
          !video
        ) {
          return;
        }

        const currentProgress =
          Math.min(
            100,
            Math.max(
              0,
              Number(
                video.progress ?? 0
              )
            )
          );

        setProgress(
          currentProgress
        );

        setProcessingSpeed(
          video.processingSpeed
        );

        setProcessingEta(
          video.processingEta
        );

        setProcessingElapsed(
          video.processingElapsed
        );

        setProcessingFps(
          video.processingFps
        );

        setProcessingStage(
          video.processingStage
        );

        setEncoderUsed(
          video.encoderUsed
        );

        /*
         * Worker finished.
         */
        if (
          video.status ===
          "READY"
        ) {
          setProgress(100);

          setProcessingEta(0);

          setProcessingStage(
            "READY"
          );

          setStatus(
            "complete"
          );

          setMessage(
            "Video processing completed successfully. Your video is ready to watch."
          );

          return;
        }

        /*
         * Worker failed.
         */
        if (
          video.status ===
          "FAILED"
        ) {
          setStatus("error");

          setProcessingStage(
            "FAILED"
          );

          setError(
            "Video processing failed. Please check the worker logs."
          );

          return;
        }

        /*
         * Still processing.
         */
        if (
          video.status ===
          "PROCESSING"
        ) {
          const stage =
            video.processingStage ??
            "TRANSCODING";

          if (
            stage ===
            "GENERATING_THUMBNAIL"
          ) {
            setMessage(
              "Video encoding is complete. Generating thumbnail..."
            );
          } else {
            setMessage(
              "Video is being processed. This page will update automatically."
            );
          }
        }
      } catch (error) {
        /*
         * Temporary browser/network failures
         * should NOT mark the upload as failed.
         */
        console.warn(
          "Processing status polling failed:",
          error
        );
      }
    }

    /*
     * Delay the first request one event-loop
     * cycle to avoid synchronous effect work.
     */
    const initialLoad =
      window.setTimeout(() => {
        if (!cancelled) {
          void pollProcessingStatus();
        }
      }, 0);

    const interval =
      window.setInterval(() => {
        if (!cancelled) {
          void pollProcessingStatus();
        }
      }, PROCESSING_POLL_INTERVAL);

    return () => {
      cancelled = true;

      window.clearTimeout(
        initialLoad
      );

      window.clearInterval(
        interval
      );
    };
  }, [
    status,
    videoId,
  ]);
// --------------------------------------------------
// Background processing monitor
// --------------------------------------------------

useEffect(() => {
  let cancelled = false;

  async function loadBackgroundProcessing() {
    try {
      const response = await fetch(
        "/api/videos",
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        return;
      }

      const videos =
        await response.json();

      if (
        cancelled ||
        !Array.isArray(videos)
      ) {
        return;
      }

      const processingVideos =
        videos.filter(
          (video: VideoProcessingResponse) =>
            video.status === "PROCESSING" &&
            video.id !== videoId
        );

      setBackgroundProcessing(
        processingVideos
      );
    } catch (error) {
      console.warn(
        "Background processing monitor failed:",
        error
      );
    }
  }

  // Delay initial request to avoid
  // synchronous state updates inside effect.
  const initialLoad =
    window.setTimeout(() => {
      if (!cancelled) {
        void loadBackgroundProcessing();
      }
    }, 0);

  const interval =
    window.setInterval(() => {
      if (!cancelled) {
        void loadBackgroundProcessing();
      }
    }, 3000);

  return () => {
    cancelled = true;

    window.clearTimeout(
      initialLoad
    );

    window.clearInterval(
      interval
    );
  };
}, [videoId]);
  // --------------------------------------------------
  // LocalStorage session
  // --------------------------------------------------

  async function findExistingUpload(
    selectedFile: File
  ) {
    const key =
      getFileKey(
        selectedFile
      );

    const saved =
      localStorage.getItem(
        key
      );

    if (!saved) {
      return null;
    }

    try {
      const session:
        UploadSession =
        JSON.parse(saved);

      if (
        session.fileName !==
          selectedFile.name ||
        session.fileSize !==
          selectedFile.size ||
        session.lastModified !==
          selectedFile.lastModified
      ) {
        return null;
      }

      const serverStatus =
        await getUploadStatus(
          session.videoId
        );

      if (!serverStatus) {
        localStorage.removeItem(
          key
        );

        return null;
      }

      return {
        session,
        serverStatus,
      };
    } catch {
      localStorage.removeItem(
        key
      );

      return null;
    }
  }

  function saveSession(
    selectedFile: File,
    existingVideoId: string
  ) {
    const session:
      UploadSession = {
      videoId:
        existingVideoId,

      fileName:
        selectedFile.name,

      fileSize:
        selectedFile.size,

      lastModified:
        selectedFile.lastModified,
    };

    localStorage.setItem(
      getFileKey(
        selectedFile
      ),
      JSON.stringify(
        session
      )
    );
  }

  function removeSession(
    selectedFile: File
  ) {
    localStorage.removeItem(
      getFileKey(
        selectedFile
      )
    );
  }

  // --------------------------------------------------
  // Start / Resume Upload
  // --------------------------------------------------

  async function startUpload() {
    if (!file) {
      setError(
        "Please select a video file."
      );

      return;
    }

    if (!title.trim()) {
      setError(
        "Please enter a video title."
      );

      return;
    }

    const selectedFile =
      file;

    setError("");
    setMessage("");

    cancelRef.current =
      false;

    try {
      // ----------------------------------------------
      // 1. Look for existing upload
      // ----------------------------------------------

      const existing =
        await findExistingUpload(
          selectedFile
        );

      let currentVideoId:
        string | null =
        null;

      if (existing) {
        currentVideoId =
          existing.session.videoId;

        setVideoId(
          currentVideoId
        );

        const serverStatus =
          existing.serverStatus.status;

        // --------------------------------------------
        // Already READY
        // --------------------------------------------

        if (
          serverStatus ===
          "READY"
        ) {
          setProgress(100);

          setUploadedBytes(
            selectedFile.size
          );

          setEta(0);

          setStatus(
            "complete"
          );

          setMessage(
            "This video has already been uploaded and processed successfully."
          );

          return;
        }

        // --------------------------------------------
        // Already PROCESSING
        // --------------------------------------------

        if (
          serverStatus ===
          "PROCESSING"
        ) {
          setProgress(0);

          setUploadedBytes(
            selectedFile.size
          );

          setSpeed(0);

          setEta(null);

          resetProcessingStats();

          setStatus(
            "processing"
          );

          setMessage(
            "This video is already uploaded and is being processed."
          );

          return;
        }

        // --------------------------------------------
        // FAILED
        // --------------------------------------------

        if (
          serverStatus ===
          "FAILED"
        ) {
          /*
           * Don't reuse a failed session.
           * Remove its local browser session and
           * allow the server to create a new one.
           */
          removeSession(
            selectedFile
          );

          currentVideoId =
            null;

          setVideoId(null);
        }

        // --------------------------------------------
        // Existing incomplete upload
        // --------------------------------------------

        if (
          serverStatus ===
          "UPLOADING"
        ) {
          setStatus(
            "resuming"
          );

          setUploadedChunks(
            existing.serverStatus
              .uploadedChunks
          );

          const bytes =
            calculateUploadedBytes(
              existing
                .serverStatus
                .uploadedChunks,
              selectedFile.size
            );

          setUploadedBytes(
            bytes
          );

          setProgress(
            (bytes /
              selectedFile.size) *
              100
          );

          setMessage(
            `Previous upload found. ${existing.serverStatus.uploadedChunks.length} chunks are already uploaded.`
          );
        }
      }

      // ----------------------------------------------
      // 2. Create new upload
      // ----------------------------------------------

      if (
        currentVideoId ===
        null
      ) {
        setStatus(
          "starting"
        );

        setMessage(
          "Preparing upload..."
        );

        const startResponse =
          await fetch(
            "/api/videos/upload/start",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify(
                {
                  title:
                    title.trim(),

                  fileName:
                    selectedFile.name,

                  fileSize:
                    selectedFile.size,

                  lastModified:
                    selectedFile.lastModified,
                  contentType:
      selectedFile.type ||
      "application/octet-stream",
                }
              ),
            }
          );

        const startData =
          await startResponse.json();
          const currentStorageMode =
  startData.storageMode === "r2" ? "r2" : "local";

setStorageMode(currentStorageMode);
        if (
  startData.storageMode === "r2" ||
  startData.storageMode === "local"
) {
  setStorageMode(
    startData.storageMode
  );
}  
        if (
          !startResponse.ok
        ) {
          throw new Error(
            startData.error ||
              "Failed to start upload."
          );
        }

        const newVideoId =
          startData.videoId;

        if (
          typeof newVideoId !==
            "string" ||
          !newVideoId
        ) {
          throw new Error(
            "Server did not return a valid video ID."
          );
        }

        currentVideoId =
          newVideoId;

        setVideoId(
          newVideoId
        );

        saveSession(
          selectedFile,
          newVideoId
        );
      }

      // ----------------------------------------------
      // 3. Guaranteed video ID
      // ----------------------------------------------

      if (
        currentVideoId ===
        null
      ) {
        throw new Error(
          "Unable to create upload session."
        );
      }

      const uploadVideoId:
        string =
        currentVideoId;

      const statusData =
        await getUploadStatus(
          uploadVideoId
        );

      if (!statusData) {
        throw new Error(
          "Unable to check upload progress."
        );
      }

      const completed =
        new Set(
          statusData.uploadedChunks
        );

      setUploadedChunks(
        Array.from(
          completed
        )
      );

      const initialBytes =
        calculateUploadedBytes(
          Array.from(
            completed
          ),
          selectedFile.size
        );

      setUploadedBytes(
        initialBytes
      );

      setProgress(
        (initialBytes /
          selectedFile.size) *
          100
      );

      // ----------------------------------------------
      // 4. Find missing chunks
      // ----------------------------------------------

      const totalChunks =
        Math.ceil(
          selectedFile.size /
            CHUNK_SIZE
        );

      const pendingChunks:
        number[] = [];

      for (
        let i = 0;
        i < totalChunks;
        i++
      ) {
        if (
          !completed.has(i)
        ) {
          pendingChunks.push(i);
        }
      }

      // ----------------------------------------------
      // 5. Upload missing chunks
      // ----------------------------------------------

      if (
        pendingChunks.length >
        0
      ) {
        setStatus(
          "uploading"
        );

        setMessage(
          completed.size > 0
            ? `Resuming upload... ${completed.size} chunks already uploaded.`
            : "Uploading video..."
        );

        startTimeRef.current =
          Date.now();

        let nextIndex = 0;

        async function uploadChunk(
          chunkIndex: number
        ) {
          if (
            cancelRef.current
          ) {
            throw new Error(
              "Upload cancelled."
            );
          }

          const chunkStart =
            chunkIndex *
            CHUNK_SIZE;

          const chunkEnd =
            Math.min(
              chunkStart +
                CHUNK_SIZE,
              selectedFile.size
            );

          const chunkBlob =
            selectedFile.slice(
              chunkStart,
              chunkEnd
            );

          let lastError:
            unknown = null;

          for (
            let attempt = 1;
            attempt <=
            MAX_RETRIES;
            attempt++
          ) {
            if (
              cancelRef.current
            ) {
              throw new Error(
                "Upload cancelled."
              );
            }

            try {
              let response: Response;

if (storageMode === "r2") {
  // Ask our server for a presigned R2 upload URL
  const urlResponse = await fetch("/api/videos/upload/chunk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      videoId: uploadVideoId,
      chunkIndex,
    }),
  });

  const urlData = await urlResponse.json();

  if (!urlResponse.ok) {
    throw new Error(
      urlData.error || "Failed to get R2 upload URL"
    );
  }

  if (!urlData.uploadUrl) {
    throw new Error("R2 upload URL was not returned");
  }

  // Upload the actual chunk directly to R2
  response = await fetch(urlData.uploadUrl, {
    method: "PUT",
    body: chunkBlob,
  });
} else {
  // Existing local-disk upload flow
  const formData = new FormData();
  formData.append("videoId", uploadVideoId);
  formData.append("chunkIndex", String(chunkIndex));
  formData.append("chunk", chunkBlob);

  response = await fetch("/api/videos/upload/chunk", {
    method: "POST",
    body: formData,
  });
}

              if (
                !response.ok
              ) {
                let errorMessage =
                  "Chunk upload failed.";

                try {
                  const data =
                    await response.json();

                  errorMessage =
                    data.error ||
                    errorMessage;
                } catch {}

                throw new Error(
                  errorMessage
                );
              }

              return;
            } catch (
              error
            ) {
              lastError =
                error;

              if (
                attempt <
                MAX_RETRIES
              ) {
                await new Promise(
                  (
                    resolve
                  ) =>
                    setTimeout(
                      resolve,
                      1000 *
                        attempt
                    )
                );
              }
            }
          }

          throw lastError instanceof
            Error
            ? lastError
            : new Error(
                `Failed to upload chunk ${chunkIndex}.`
              );
        }

        async function uploadWorker() {
          while (true) {
            if (
              cancelRef.current
            ) {
              throw new Error(
                "Upload cancelled."
              );
            }

            const position =
              nextIndex++;

            if (
              position >=
              pendingChunks.length
            ) {
              return;
            }

            const chunkIndex =
              pendingChunks[
                position
              ];

            await uploadChunk(
              chunkIndex
            );

            completed.add(
              chunkIndex
            );

            const currentBytes =
              calculateUploadedBytes(
                Array.from(
                  completed
                ),
                selectedFile.size
              );

            setUploadedChunks(
              Array.from(
                completed
              )
            );

            setUploadedBytes(
              currentBytes
            );

            setProgress(
              (currentBytes /
                selectedFile.size) *
                100
            );

            calculateStats(
              currentBytes,
              selectedFile.size
            );
          }
        }

        const workerCount =
          Math.min(
            MAX_CONCURRENT,
            pendingChunks.length
          );

        await Promise.all(
          Array.from(
            {
              length:
                workerCount,
            },
            () =>
              uploadWorker()
          )
        );
      }

      // ----------------------------------------------
      // 6. Cancel check
      // ----------------------------------------------

      if (
        cancelRef.current
      ) {
        setStatus(
          "cancelled"
        );

        setMessage(
          "Upload stopped. Your uploaded chunks are saved and can be resumed."
        );

        return;
      }

      // ----------------------------------------------
      // 7. Finalize upload
      // ----------------------------------------------

      setMessage(
        "Finalizing upload..."
      );

      const completeResponse =
        await fetch(
          "/api/videos/upload/complete",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              {
                videoId:
                  uploadVideoId,

                fileName:
                  selectedFile.name,

                totalChunks,
              }
            ),
          }
        );

      const completeData =
        await completeResponse.json();

      if (
        !completeResponse.ok
      ) {
        throw new Error(
          completeData.error ||
            "Failed to finalize upload."
        );
      }

      // ----------------------------------------------
      // 8. Upload complete → Processing begins
      // ----------------------------------------------

      setProgress(0);

      setUploadedBytes(
        selectedFile.size
      );

      setSpeed(0);

      setEta(null);

      resetProcessingStats();

      setStatus(
        "processing"
      );

      setMessage(
        "Upload complete. Video processing has started."
      );

      /*
       * Important:
       *
       * We DO NOT remove the session here until
       * processing is complete.
       *
       * That means if the browser is refreshed,
       * selecting the same file can still identify
       * the video being processed.
       */
    } catch (error) {
      console.error(
        "Upload error:",
        error
      );

      if (
        error instanceof Error &&
        error.message ===
          "Upload cancelled."
      ) {
        setStatus(
          "cancelled"
        );

        setMessage(
          "Upload stopped. Your uploaded chunks are saved and can be resumed."
        );

        return;
      }

      setStatus(
        "error"
      );

      setError(
        error instanceof Error
          ? error.message
          : "Upload failed."
      );
    }
  }

  // --------------------------------------------------
  // Cancel
  // --------------------------------------------------

  function cancelUpload() {
    cancelRef.current =
      true;

    setStatus(
      "cancelled"
    );

    setMessage(
      "Upload stopped. Your uploaded chunks are saved and can be resumed."
    );
  }

  // --------------------------------------------------
  // Reset
  // --------------------------------------------------

  function resetUpload() {
    cancelRef.current =
      true;

    /*
     * If the video is already being processed,
     * do not delete the browser session.
     */
    if (
      file &&
      status !==
        "processing"
    ) {
      removeSession(file);
    }

    setFile(null);

    setTitle("");

    setVideoId(null);

    setUploadedChunks(
      []
    );

    setProgress(0);

    setUploadedBytes(
      0
    );

    setSpeed(0);

    setEta(null);

    resetProcessingStats();

    setStatus(
      "idle"
    );

    setMessage("");

    setError("");

    startTimeRef.current =
      null;
  }

  // --------------------------------------------------
  // File selection
  // --------------------------------------------------

  async function handleFileSelect(
    selectedFile: File | null
  ) {
    if (!selectedFile) {
      return;
    }

    setFile(
      selectedFile
    );

    setError("");

    setMessage("");

    setProgress(0);

    setUploadedBytes(0);

    setSpeed(0);

    setEta(null);

    resetProcessingStats();

    setVideoId(null);

    setUploadedChunks(
      []
    );

    setStatus(
      "idle"
    );

    const existing =
      await findExistingUpload(
        selectedFile
      );

    if (!existing) {
      return;
    }

    const existingStatus =
      existing.serverStatus.status;

    const existingVideoId =
      existing.session.videoId;

    setVideoId(
      existingVideoId
    );

    // ----------------------------------------------
    // READY
    // ----------------------------------------------

    if (
      existingStatus ===
      "READY"
    ) {
      setProgress(100);

      setUploadedBytes(
        selectedFile.size
      );

      setEta(0);

      setStatus(
        "complete"
      );

      setMessage(
        "This video has already been uploaded and processed successfully."
      );

      return;
    }

    // ----------------------------------------------
    // PROCESSING
    // ----------------------------------------------

    if (
      existingStatus ===
      "PROCESSING"
    ) {
      setUploadedBytes(
        selectedFile.size
      );

      setStatus(
        "processing"
      );

      setMessage(
        "This video is already uploaded and is being processed."
      );

      /*
       * Immediately fetch current processing state.
       */
      const video =
        await getVideoProcessingStatus(
          existingVideoId
        );

      if (video) {
        setProgress(
          Math.min(
            100,
            Math.max(
              0,
              video.progress ?? 0
            )
          )
        );

        setProcessingSpeed(
          video.processingSpeed
        );

        setProcessingEta(
          video.processingEta
        );

        setProcessingElapsed(
          video.processingElapsed
        );

        setProcessingFps(
          video.processingFps
        );

        setProcessingStage(
          video.processingStage
        );

        setEncoderUsed(
          video.encoderUsed
        );

        if (
          video.status ===
          "READY"
        ) {
          setProgress(100);

          setProcessingEta(0);

          setStatus(
            "complete"
          );

          setMessage(
            "Video processing completed successfully."
          );
        }
      }

      return;
    }

    // ----------------------------------------------
    // FAILED
    // ----------------------------------------------

    if (
      existingStatus ===
      "FAILED"
    ) {
      removeSession(
        selectedFile
      );

      setVideoId(null);

      setStatus(
        "idle"
      );

      setMessage(
        "The previous processing attempt failed. You can upload this video again."
      );

      return;
    }

    // ----------------------------------------------
    // Previous incomplete upload
    // ----------------------------------------------

    if (
      existingStatus ===
      "UPLOADING"
    ) {
      const chunks =
        existing.serverStatus
          .uploadedChunks;

      const bytes =
        calculateUploadedBytes(
          chunks,
          selectedFile.size
        );

      setUploadedChunks(
        chunks
      );

      setUploadedBytes(
        bytes
      );

      setProgress(
        (bytes /
          selectedFile.size) *
          100
      );

      setStatus(
        "resuming"
      );

      setMessage(
        `Previous upload found. ${chunks.length} chunks are already uploaded. Click "Resume Upload" to continue.`
      );
    }
  }

  // --------------------------------------------------
  // Drag & Drop
  // --------------------------------------------------

  function handleDrop(
    event: React.DragEvent<HTMLDivElement>
  ) {
    event.preventDefault();

    setDragging(false);

    const droppedFile =
      event.dataTransfer
        .files?.[0];

    if (droppedFile) {
      void handleFileSelect(
        droppedFile
      );
    }
  }

  function handleFileInput(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const selectedFile =
      event.target.files?.[0];

    if (selectedFile) {
      void handleFileSelect(
        selectedFile
      );
    }
  }

  // --------------------------------------------------
  // UI state
  // --------------------------------------------------

  const isActivelyUploading =
    status === "starting" ||
    status === "uploading";

  const canStart =
    !!file &&
    !!title.trim() &&
    !isActivelyUploading &&
    status !==
      "processing" &&
    status !==
      "complete";

  const safeProcessingProgress =
    Math.min(
      100,
      Math.max(
        0,
        Number(
          progress ?? 0
        )
      )
    );

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
        {/* HEADER */}

        <div className="mb-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-blue-400">
            Admin
          </p>

          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Upload Video
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Upload large video files with
            chunked, resumable uploads.
            Processing starts automatically
            after upload completion.
          </p>
        </div>
{/* =================================================
    BACKGROUND PROCESSING
================================================== */}

{backgroundProcessing.length > 0 && (
  <div className="mb-6 overflow-hidden rounded-2xl border border-amber-500/20 bg-slate-900/70 shadow-xl">
    <div className="border-b border-slate-800 bg-amber-500/5 px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />

            <h2 className="text-base font-semibold text-white">
              Background Processing
            </h2>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            These videos are being processed by
            the backend worker.
          </p>
        </div>

        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
          {backgroundProcessing.length}{" "}
          {backgroundProcessing.length === 1
            ? "active"
            : "active"}
        </span>
      </div>
    </div>

    <div className="divide-y divide-slate-800">
      {backgroundProcessing.map(
        (video) => {
          const processingProgress =
            Math.min(
              100,
              Math.max(
                0,
                Number(
                  video.progress ?? 0
                )
              )
            );

          return (
            <div
              key={video.id}
              className="px-6 py-5"
            >
              <div className="flex flex-col gap-4">
                {/* Video information */}

                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-white">
                      {video.title}
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      {video.processingStage ===
                      "GENERATING_THUMBNAIL"
                        ? "Generating thumbnail"
                        : video.processingStage ===
                          "UPLOADING_TO_R2"
                        ? "Uploading HLS to R2"
                        : "Transcoding"}
                    </p>
                  </div>

                  <span className="shrink-0 text-sm font-bold text-amber-300">
                    {Math.round(
                      processingProgress
                    )}
                    %
                  </span>
                </div>

                {/* Progress bar */}

                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-700"
                    style={{
                      width: `${processingProgress}%`,
                    }}
                  />
                </div>

                {/* Processing statistics */}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-600">
                      Encoder
                    </p>

                    <p className="mt-1 truncate text-xs font-medium text-slate-300">
                      {video.encoderUsed ??
                        "Detecting..."}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-600">
                      Speed
                    </p>

                    <p className="mt-1 text-xs font-medium text-slate-300">
                      {video.processingSpeed !==
                        null &&
                      Number.isFinite(
                        video.processingSpeed
                      )
                        ? `${video.processingSpeed.toFixed(
                            1
                          )}x`
                        : "--"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-600">
                      ETA
                    </p>

                    <p className="mt-1 text-xs font-medium text-slate-300">
                      {video.processingEta !==
                        null &&
                      Number.isFinite(
                        video.processingEta
                      )
                        ? formatTime(
                            video.processingEta
                          )
                        : "--"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-600">
                      FPS
                    </p>

                    <p className="mt-1 text-xs font-medium text-slate-300">
                      {video.processingFps !==
                        null &&
                      Number.isFinite(
                        video.processingFps
                      )
                        ? video.processingFps.toFixed(
                            1
                          )
                        : "--"}
                    </p>
                  </div>
                </div>

                {/* Elapsed */}

                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>
                    Elapsed{" "}
                    {video.processingElapsed !==
                      null &&
                    Number.isFinite(
                      video.processingElapsed
                    )
                      ? formatTime(
                          video.processingElapsed
                        )
                      : "--"}
                  </span>

                  <span>
                    Processing in background
                  </span>
                </div>
              </div>
            </div>
          );
        }
      )}
    </div>

    {/* Link to full dashboard */}

    <div className="border-t border-slate-800 bg-slate-950/30 px-6 py-4">
      <a
        href="/admin/homepage"
        className="text-xs font-medium text-blue-400 transition hover:text-blue-300"
      >
        View full processing queue →
      </a>
    </div>
  </div>
)}
        {/* MAIN CARD */}

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-2xl">
          <div className="p-6 sm:p-8">
            {/* TITLE */}

            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-slate-200">
                Video title
              </label>

              <input
                type="text"
                value={title}
                onChange={(event) =>
                  setTitle(
                    event.target
                      .value
                  )
                }
                placeholder="Enter video title"
                disabled={
                  isActivelyUploading
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {/* FILE DROP */}

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(
                  true
                );
              }}
              onDragLeave={() =>
                setDragging(
                  false
                )
              }
              onDrop={
                handleDrop
              }
              className={`relative rounded-2xl border-2 border-dashed p-8 text-center transition ${
                dragging
                  ? "border-blue-400 bg-blue-500/10"
                  : "border-slate-700 bg-slate-950/50 hover:border-slate-600"
              }`}
            >
              <input
                id="video-file"
                type="file"
                accept="video/*"
                onChange={
                  handleFileInput
                }
                disabled={
                  isActivelyUploading
                }
                className="hidden"
              />

              {!file ? (
                <>
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-2xl">
                    🎬
                  </div>

                  <h2 className="text-base font-semibold text-white">
                    Choose a video
                  </h2>

                  <p className="mt-2 text-sm text-slate-500">
                    Drag and drop your
                    video here, or choose
                    a file manually.
                  </p>

                  <label
                    htmlFor="video-file"
                    className="mt-5 inline-flex cursor-pointer items-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
                  >
                    Choose File
                  </label>
                </>
              ) : (
                <>
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-2xl">
                    🎥
                  </div>

                  <h2 className="break-all text-base font-semibold text-white">
                    {file.name}
                  </h2>

                  <p className="mt-2 text-sm text-slate-400">
                    {formatBytes(
                      file.size
                    )}
                  </p>

                  {!isActivelyUploading && (
                    <label
                      htmlFor="video-file"
                      className="mt-4 inline-flex cursor-pointer text-sm font-medium text-blue-400 hover:text-blue-300"
                    >
                      Choose another
                      file
                    </label>
                  )}
                </>
              )}
            </div>

            {/* RESUME MESSAGE */}

            {status ===
              "resuming" &&
              uploadedChunks.length >
                0 && (
                <div className="mt-5 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-blue-400">
                      ↻
                    </span>

                    <div>
                      <p className="text-sm font-medium text-blue-300">
                        Resumable upload
                        found
                      </p>

                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        {
                          uploadedChunks.length
                        }{" "}
                        chunks are already
                        uploaded. Click
                        Resume Upload to
                        continue.
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {/* =================================================
                UPLOAD / PROCESSING PROGRESS
            ================================================== */}

            {(isActivelyUploading ||
              status ===
                "resuming" ||
              status ===
                "cancelled" ||
              status ===
                "processing" ||
              status ===
                "complete") && (
              <div className="mt-7">
                {/* Header */}

                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-slate-200">
                      {status ===
                      "processing"
                        ? processingStage ===
                          "GENERATING_THUMBNAIL"
                          ? "Generating thumbnail"
                          : processingStage ===
                            "UPLOADING_TO_R2"
                          ? "Uploading HLS to R2"
                          : "Processing video"
                        : status ===
                          "complete"
                        ? "Complete"
                        : status ===
                          "cancelled"
                        ? "Cancelled"
                        : status ===
                          "resuming"
                        ? "Ready to Resume"
                        : "Uploading"}
                    </span>

                    {status ===
                      "processing" &&
                      processingStage && (
                        <p className="mt-1 text-xs text-slate-500">
                          {processingStage ===
                          "TRANSCODING"
                            ? "Creating adaptive HLS streams"
                            : processingStage ===
                              "GENERATING_THUMBNAIL"
                            ? "Creating preview artwork"
                            : processingStage ===
                              "UPLOADING_TO_R2"
                            ? "Uploading HLS streams to R2"
                            : processingStage}
                        </p>
                      )}
                  </div>

                  <span className="text-sm font-semibold text-white">
                    {safeProcessingProgress.toFixed(
                      1
                    )}
                    %
                  </span>
                </div>

                {/* Progress bar */}

                <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      status ===
                      "processing"
                        ? "bg-amber-500"
                        : status ===
                          "complete"
                        ? "bg-emerald-500"
                        : "bg-blue-500"
                    }`}
                    style={{
                      width: `${safeProcessingProgress}%`,
                    }}
                  />
                </div>

                {/* =========================================
                    UPLOAD STATS
                ========================================== */}

                {status !==
                  "processing" &&
                  status !==
                    "complete" && (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs text-slate-500">
                          Uploaded
                        </p>

                        <p className="mt-1 text-sm font-semibold text-white">
                          {formatBytes(
                            uploadedBytes
                          )}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs text-slate-500">
                          Total
                        </p>

                        <p className="mt-1 text-sm font-semibold text-white">
                          {file
                            ? formatBytes(
                                file.size
                              )
                            : "--"}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs text-slate-500">
                          Upload Speed
                        </p>

                        <p className="mt-1 text-sm font-semibold text-white">
                          {speed >
                          0
                            ? `${formatBytes(
                                speed
                              )}/s`
                            : "--"}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs text-slate-500">
                          Remaining
                        </p>

                        <p className="mt-1 text-sm font-semibold text-white">
                          {status ===
                          "cancelled"
                            ? "--"
                            : formatTime(
                                eta
                              )}
                        </p>
                      </div>
                    </div>
                  )}

                {/* =========================================
                    PROCESSING STATS
                ========================================== */}

                {status ===
                  "processing" && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {/* Completed */}

                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs text-slate-500">
                        Completed
                      </p>

                      <p className="mt-1 text-sm font-semibold text-white">
                        {Math.round(
                          safeProcessingProgress
                        )}
                        %
                      </p>
                    </div>

                    {/* ETA */}

                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs text-slate-500">
                        Estimated Left
                      </p>

                      <p className="mt-1 text-sm font-semibold text-white">
                        {processingStage ===
                        "GENERATING_THUMBNAIL"
                          ? "Almost done"
                          : formatTime(
                              processingEta
                            )}
                      </p>
                    </div>

                    {/* Speed */}

                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs text-slate-500">
                        {processingStage ===
                        "UPLOADING_TO_R2"
                          ? "Upload Speed"
                          : "Encode Speed"}
                      </p>

                      <p className="mt-1 text-sm font-semibold text-white">
                        {processingSpeed !==
                          null &&
                        Number.isFinite(
                          processingSpeed
                        )
                          ? `${processingSpeed.toFixed(
                              1
                            )}x realtime`
                          : "--"}
                      </p>
                    </div>

                    {/* Encoder */}

                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs text-slate-500">
                        Encoder
                      </p>

                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {encoderUsed ??
                          "Detecting..."}
                      </p>
                    </div>
                  </div>
                )}

                {/* R2 UPLOAD INFORMATION */}

                {status ===
                  "processing" &&
                  processingStage ===
                    "UPLOADING_TO_R2" && (
                  <div className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-300">
                    HLS video, audio, playlists and initialization
                    files are being uploaded to R2.
                  </div>
                )}

                {/* Processing secondary information */}

                {status ===
                  "processing" && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      Elapsed{" "}
                      {formatTime(
                        processingElapsed
                      )}
                    </span>

                    <span>
                      {processingStage ===
                      "UPLOADING_TO_R2"
                        ? "Uploading HLS streams to R2"
                        : `FPS ${
                            processingFps !==
                              null &&
                            Number.isFinite(
                              processingFps
                            )
                              ? processingFps.toFixed(
                                  1
                                )
                              : "--"
                          }`}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* MESSAGE */}

            {message && (
              <div
                className={`mt-6 rounded-xl border px-4 py-3 ${
                  status ===
                  "complete"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : status ===
                      "processing"
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-slate-800 bg-slate-950/60"
                }`}
              >
                <p
                  className={`text-sm ${
                    status ===
                    "complete"
                      ? "text-emerald-300"
                      : status ===
                        "processing"
                      ? "text-amber-300"
                      : "text-slate-300"
                  }`}
                >
                  {message}
                </p>
              </div>
            )}

            {/* ERROR */}

            {error && (
              <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                <p className="text-sm text-red-300">
                  {error}
                </p>
              </div>
            )}

            {/* BUTTONS */}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              {/* UPLOADING */}

              {isActivelyUploading ? (
                <button
                  type="button"
                  onClick={
                    cancelUpload
                  }
                  className="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
                >
                  Cancel Upload
                </button>
              ) : status ===
                "processing" ? (
                <button
                  type="button"
                  disabled
                  className="flex-1 cursor-not-allowed rounded-xl bg-amber-500/10 px-5 py-3 text-sm font-semibold text-amber-300"
                >
                  {processingStage ===
                  "GENERATING_THUMBNAIL"
                    ? "Generating Thumbnail..."
                    : "Processing Video..."}
                </button>
              ) : status ===
                "complete" ? (
                <button
                  type="button"
                  onClick={
                    resetUpload
                  }
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Upload Another
                  Video
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={
                      startUpload
                    }
                    disabled={
                      !canStart
                    }
                    className="flex-1 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {status ===
                    "resuming"
                      ? "Resume Upload"
                      : "Start Upload"}
                  </button>

                  {(status ===
                    "cancelled" ||
                    status ===
                      "error") && (
                    <button
                      type="button"
                      onClick={
                        resetUpload
                      }
                      className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                    >
                      Reset
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* FOOTER */}

          <div className="border-t border-slate-800 bg-slate-950/40 px-6 py-4 sm:px-8">
            <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Chunk size:{" "}
                {formatBytes(
                  CHUNK_SIZE
                )}
              </span>

              <span>
                Up to{" "}
                {MAX_CONCURRENT}{" "}
                chunks simultaneously
              </span>

              <span>
                Failed chunks retry up
                to{" "}
                {MAX_RETRIES}{" "}
                times
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}