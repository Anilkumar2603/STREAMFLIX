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
const R2_WORKER_URL = process.env.NEXT_PUBLIC_R2_WORKER_URL;

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
  storageMode?: "local" | "r2";
  uploadToken?: string;
  objectKey?: string;
  uploadId?: string;
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
  // R2 browser upload helpers
  // --------------------------------------------------

  async function createR2MultipartUpload(
    token: string,
    objectKey: string,
    contentType: string
  ) {
    if (!R2_WORKER_URL) {
      throw new Error(
        "R2 Worker URL is not configured."
      );
    }

    const url =
      `${R2_WORKER_URL}/multipart` +
      `?action=create` +
      `&key=${encodeURIComponent(objectKey)}` +
      `&contentType=${encodeURIComponent(contentType)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Failed to create R2 multipart upload."
      );
    }

    if (!data.uploadId) {
      throw new Error(
        "R2 Worker did not return an upload ID."
      );
    }

    return {
      uploadId: String(data.uploadId),
      objectKey: String(data.objectKey || objectKey),
    };
  }

  async function getR2UploadedParts(
    token: string,
    objectKey: string,
    uploadId: string
  ) {
    if (!R2_WORKER_URL) {
      throw new Error(
        "R2 Worker URL is not configured."
      );
    }

    const url =
      `${R2_WORKER_URL}/multipart` +
      `?action=parts` +
      `&key=${encodeURIComponent(objectKey)}` +
      `&uploadId=${encodeURIComponent(uploadId)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Failed to get R2 upload status."
      );
    }

    return (data.parts || []) as Array<{
      partNumber: number;
      etag: string;
    }>;
  }

  async function uploadR2Part(
    token: string,
    objectKey: string,
    uploadId: string,
    partNumber: number,
    chunk: Blob
  ) {
    if (!R2_WORKER_URL) {
      throw new Error(
        "R2 Worker URL is not configured."
      );
    }

    const url =
      `${R2_WORKER_URL}/multipart` +
      `?action=uploadpart` +
      `&key=${encodeURIComponent(objectKey)}` +
      `&uploadId=${encodeURIComponent(uploadId)}` +
      `&partNumber=${partNumber}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: chunk,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          `Failed to upload part ${partNumber}.`
      );
    }

    return data as {
      success: boolean;
      partNumber: number;
      etag: string;
    };
  }

  async function completeR2MultipartUpload(
    token: string,
    objectKey: string,
    uploadId: string,
    parts: Array<{
      partNumber: number;
      etag: string;
    }>
  ) {
    if (!R2_WORKER_URL) {
      throw new Error(
        "R2 Worker URL is not configured."
      );
    }

    const url =
      `${R2_WORKER_URL}/multipart` +
      `?action=complete` +
      `&key=${encodeURIComponent(objectKey)}` +
      `&uploadId=${encodeURIComponent(uploadId)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parts,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Failed to finalize R2 multipart upload."
      );
    }

    if (!data.completionProof) {
      throw new Error(
        "R2 Worker did not return a completion proof."
      );
    }

    return data as {
      success: boolean;
      key: string;
      etag: string;
      size: number;
      completionProof: string;
    };
  }

  async function requestR2UploadCapability(
    selectedFile: File,
    videoId?: string
  ) {
    const response = await fetch(
      "/api/videos/upload/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          lastModified: selectedFile.lastModified,
          contentType:
            selectedFile.type ||
            "application/octet-stream",
          ...(videoId ? { videoId } : {}),
        }),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || "Failed to prepare R2 upload."
      );
    }

    const returnedVideoId =
      typeof data.videoId === "string"
        ? data.videoId
        : "";

    const uploadToken =
      typeof data.uploadToken === "string"
        ? data.uploadToken
        : "";

    const objectKey =
      typeof data.objectKey === "string"
        ? data.objectKey
        : "";

    if (!returnedVideoId || !uploadToken || !objectKey) {
      throw new Error(
        "Upload server did not return the R2 upload capability."
      );
    }

    return {
      videoId: returnedVideoId,
      uploadToken,
      objectKey,
      storageMode:
        data.storageMode === "r2" ? "r2" : "local",
      status:
        typeof data.status === "string"
          ? data.status
          : "UPLOADING",
    } as const;
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
    const key = getFileKey(selectedFile);
    const saved = localStorage.getItem(key);

    if (!saved) {
      return null;
    }

    try {
      const session = JSON.parse(saved) as UploadSession;

      if (
        session.fileName !== selectedFile.name ||
        session.fileSize !== selectedFile.size ||
        session.lastModified !== selectedFile.lastModified
      ) {
        return null;
      }

      // R2 status is read from PostgreSQL only. We do not call the
      // server upload-status endpoint because that endpoint would make
      // a server-side R2 request from this machine.
      if (session.storageMode === "r2") {
        const video = await getVideoProcessingStatus(
          session.videoId
        );

        if (!video) {
          localStorage.removeItem(key);
          return null;
        }

        return {
          session,
          serverStatus: {
            videoId: session.videoId,
            status: video.status,
            uploadedChunks: [],
            storageMode: "r2" as const,
          },
        };
      }

      const serverStatus = await getUploadStatus(
        session.videoId
      );

      if (!serverStatus) {
        localStorage.removeItem(key);
        return null;
      }

      return {
        session,
        serverStatus,
      };
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  function saveSession(
    selectedFile: File,
    sessionData: {
      videoId: string;
      storageMode: "local" | "r2";
      uploadToken?: string;
      objectKey?: string;
      uploadId?: string;
    }
  ) {
    const session: UploadSession = {
      videoId: sessionData.videoId,
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      lastModified: selectedFile.lastModified,
      storageMode: sessionData.storageMode,
      uploadToken: sessionData.uploadToken,
      objectKey: sessionData.objectKey,
      uploadId: sessionData.uploadId,
    };

    localStorage.setItem(
      getFileKey(selectedFile),
      JSON.stringify(session)
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
      setError("Please select a video file.");
      return;
    }

    if (!title.trim()) {
      setError("Please enter a video title.");
      return;
    }

    const selectedFile = file;
    setError("");
    setMessage("");
    cancelRef.current = false;

    try {
      const existing = await findExistingUpload(selectedFile);

      let currentVideoId: string | null = null;
      let currentStorageMode: "local" | "r2" =
        existing?.session.storageMode ||
        (existing?.serverStatus.storageMode === "r2"
          ? "r2"
          : "local");
      let currentUploadToken = existing?.session.uploadToken;
      let currentObjectKey = existing?.session.objectKey;
      let currentUploadId = existing?.session.uploadId;

      if (existing) {
        currentVideoId = existing.session.videoId;
        setVideoId(currentVideoId);
        setStorageMode(currentStorageMode);

        const serverStatus = existing.serverStatus.status;

        if (serverStatus === "READY") {
          setProgress(100);
          setUploadedBytes(selectedFile.size);
          setEta(0);
          setStatus("complete");
          setMessage(
            "This video has already been uploaded and processed successfully."
          );
          return;
        }

        if (serverStatus === "PROCESSING") {
          setProgress(0);
          setUploadedBytes(selectedFile.size);
          setSpeed(0);
          setEta(null);
          resetProcessingStats();
          setStatus("processing");
          setMessage(
            "This video is already uploaded and is being processed."
          );
          return;
        }

        if (serverStatus === "FAILED") {
          removeSession(selectedFile);
          currentVideoId = null;
          currentUploadToken = undefined;
          currentObjectKey = undefined;
          currentUploadId = undefined;
          setVideoId(null);
        }

        if (serverStatus === "UPLOADING") {
          setStatus("resuming");
          setMessage("Previous upload found. Checking uploaded chunks...");
        }
      }

      // Create a new database upload session/capability when needed.
      if (currentVideoId === null) {
        setStatus("starting");
        setMessage("Preparing upload...");

        const prepared = await requestR2UploadCapability(
          selectedFile
        );

        currentVideoId = prepared.videoId;
        currentStorageMode = prepared.storageMode;
        currentUploadToken = prepared.uploadToken;
        currentObjectKey = prepared.objectKey;

        setVideoId(currentVideoId);
        setStorageMode(currentStorageMode);

        if (currentStorageMode === "r2") {
          if (!currentUploadToken || !currentObjectKey) {
            throw new Error(
              "R2 upload session is incomplete."
            );
          }

          const multipart = await createR2MultipartUpload(
            currentUploadToken,
            currentObjectKey,
            selectedFile.type || "application/octet-stream"
          );

          currentUploadId = multipart.uploadId;
          currentObjectKey = multipart.objectKey;

          if (!currentVideoId || !currentUploadId) {
            throw new Error(
              "Unable to create R2 upload session."
            );
          }

          saveSession(selectedFile, {
            videoId: currentVideoId,
            storageMode: "r2",
            uploadToken: currentUploadToken,
            objectKey: currentObjectKey,
            uploadId: currentUploadId,
          });
        } else {
          if (!currentVideoId) {
            throw new Error(
              "Unable to create upload session."
            );
          }

          saveSession(selectedFile, {
            videoId: currentVideoId,
            storageMode: "local",
          });
        }
      } else if (currentStorageMode === "r2") {
        // Refresh the short-lived capability on every resume.
        // This never exposes the master R2 token.
        const prepared = await requestR2UploadCapability(
          selectedFile,
          currentVideoId
        );

        currentUploadToken = prepared.uploadToken;
        currentObjectKey = prepared.objectKey;

        if (!currentUploadToken || !currentObjectKey) {
          throw new Error("R2 upload session is incomplete.");
        }

        // Old browser sessions may not have an upload ID because the
        // browser-direct R2 flow was introduced after they were created.
        // In that case start a fresh multipart upload for this browser session.
        if (!currentUploadId) {
          const multipart = await createR2MultipartUpload(
            currentUploadToken,
            currentObjectKey,
            selectedFile.type || "application/octet-stream"
          );
          currentUploadId = multipart.uploadId;
          currentObjectKey = multipart.objectKey;
        }

        saveSession(selectedFile, {
          videoId: currentVideoId,
          storageMode: "r2",
          uploadToken: currentUploadToken,
          objectKey: currentObjectKey,
          uploadId: currentUploadId,
        });
      }

      if (!currentVideoId) {
        throw new Error("Unable to create upload session.");
      }

      const uploadVideoId = currentVideoId;
      const totalChunks = Math.ceil(
        selectedFile.size / CHUNK_SIZE
      );

      let completed = new Set<number>();

      if (currentStorageMode === "r2") {
        if (
          !currentUploadToken ||
          !currentObjectKey ||
          !currentUploadId
        ) {
          throw new Error("R2 upload session is incomplete.");
        }

        const parts = await getR2UploadedParts(
          currentUploadToken,
          currentObjectKey,
          currentUploadId
        );

        completed = new Set(
          parts
            .map((part) => part.partNumber - 1)
            .filter(
              (index) =>
                Number.isInteger(index) &&
                index >= 0 &&
                index < totalChunks
            )
        );
      } else {
        const statusData = await getUploadStatus(uploadVideoId);

        if (!statusData) {
          throw new Error("Unable to check upload progress.");
        }

        completed = new Set(statusData.uploadedChunks);
      }

      setUploadedChunks(Array.from(completed).sort((a, b) => a - b));

      const initialBytes = calculateUploadedBytes(
        Array.from(completed),
        selectedFile.size
      );

      setUploadedBytes(initialBytes);
      setProgress(
        selectedFile.size > 0
          ? (initialBytes / selectedFile.size) * 100
          : 0
      );

      const pendingChunks: number[] = [];

      for (let i = 0; i < totalChunks; i++) {
        if (!completed.has(i)) {
          pendingChunks.push(i);
        }
      }

      if (pendingChunks.length > 0) {
        setStatus("uploading");
        setMessage(
          completed.size > 0
            ? `Resuming upload... ${completed.size} chunks already uploaded.`
            : "Uploading video..."
        );

        startTimeRef.current = Date.now();

        let nextIndex = 0;

        async function uploadChunk(chunkIndex: number) {
          if (cancelRef.current) {
            throw new Error("Upload cancelled.");
          }

          const chunkStart = chunkIndex * CHUNK_SIZE;
          const chunkEnd = Math.min(
            chunkStart + CHUNK_SIZE,
            selectedFile.size
          );
          const chunkBlob = selectedFile.slice(chunkStart, chunkEnd);

          let lastError: unknown = null;

          for (
            let attempt = 1;
            attempt <= MAX_RETRIES;
            attempt++
          ) {
            if (cancelRef.current) {
              throw new Error("Upload cancelled.");
            }

            try {
              if (currentStorageMode === "r2") {
                if (
                  !currentUploadToken ||
                  !currentObjectKey ||
                  !currentUploadId
                ) {
                  throw new Error(
                    "R2 upload session is incomplete."
                  );
                }

                await uploadR2Part(
                  currentUploadToken,
                  currentObjectKey,
                  currentUploadId,
                  chunkIndex + 1,
                  chunkBlob
                );

                return;
              }

                
              else {
                const formData = new FormData();
                formData.append("videoId", uploadVideoId);
                formData.append("chunkIndex", String(chunkIndex));
                formData.append("chunk", chunkBlob);

                const response = await fetch(
                  "/api/videos/upload/chunk",
                  {
                    method: "POST",
                    body: formData,
                  }
                );

                if (!response.ok) {
                  let errorMessage = "Chunk upload failed.";
                  try {
                    const data = await response.json();
                    errorMessage = data.error || errorMessage;
                  } catch {}
                  throw new Error(errorMessage);
                }
              }

              return;
            } catch (error) {
              lastError = error;

              if (attempt < MAX_RETRIES) {
                await new Promise((resolve) =>
                  setTimeout(resolve, 1000 * attempt)
                );
              }
            }
          }

          throw lastError instanceof Error
            ? lastError
            : new Error(
                `Failed to upload chunk ${chunkIndex}.`
              );
        }

        async function uploadWorker() {
          while (true) {
            if (cancelRef.current) {
              throw new Error("Upload cancelled.");
            }

            const position = nextIndex++;
            if (position >= pendingChunks.length) {
              return;
            }

            const chunkIndex = pendingChunks[position];
            await uploadChunk(chunkIndex);

            completed.add(chunkIndex);

            const currentBytes = calculateUploadedBytes(
              Array.from(completed),
              selectedFile.size
            );

            const sortedChunks = Array.from(completed).sort(
              (a, b) => a - b
            );

            setUploadedChunks(sortedChunks);
            setUploadedBytes(currentBytes);
            setProgress(
              selectedFile.size > 0
                ? (currentBytes / selectedFile.size) * 100
                : 0
            );
            calculateStats(currentBytes, selectedFile.size);
          }
        }

        const workerCount = Math.min(
          MAX_CONCURRENT,
          pendingChunks.length
        );

        await Promise.all(
          Array.from(
            { length: workerCount },
            () => uploadWorker()
          )
        );
      }

      if (cancelRef.current) {
        setStatus("cancelled");
        setMessage(
          "Upload stopped. Your uploaded chunks are saved and can be resumed."
        );
        return;
      }

      // ----------------------------------------------
      // Finalize upload
      // ----------------------------------------------

      setMessage("Finalizing upload...");

      if (currentStorageMode === "r2") {
        if (
          !currentUploadToken ||
          !currentObjectKey ||
          !currentUploadId
        ) {
          throw new Error("R2 upload session is incomplete.");
        }

        const parts = await getR2UploadedParts(
          currentUploadToken,
          currentObjectKey,
          currentUploadId
        );

        if (parts.length !== totalChunks) {
          throw new Error(
            `R2 upload is missing parts. Expected ${totalChunks}, found ${parts.length}.`
          );
        }

        for (let i = 1; i <= totalChunks; i++) {
          const part = parts.find(
            (item) => item.partNumber === i
          );
          if (!part) {
            throw new Error(
              `R2 upload is missing part ${i}.`
            );
          }
        }

        const workerComplete =
          await completeR2MultipartUpload(
            currentUploadToken,
            currentObjectKey,
            currentUploadId,
            parts.sort(
              (a, b) => a.partNumber - b.partNumber
            )
          );

        const completeResponse = await fetch(
          "/api/videos/upload/complete",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              videoId: uploadVideoId,
              fileName: selectedFile.name,
              totalChunks,
              completionProof:
                workerComplete.completionProof,
            }),
          }
        );

        const completeData = await completeResponse
          .json()
          .catch(() => ({}));

        if (!completeResponse.ok) {
          throw new Error(
            completeData.error ||
              "Failed to finalize upload."
          );
        }
      } else {
        const completeResponse = await fetch(
          "/api/videos/upload/complete",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              videoId: uploadVideoId,
              fileName: selectedFile.name,
              totalChunks,
            }),
          }
        );

        const completeData = await completeResponse
          .json()
          .catch(() => ({}));

        if (!completeResponse.ok) {
          throw new Error(
            completeData.error ||
              "Failed to finalize upload."
          );
        }
      }

      setProgress(0);
      setUploadedBytes(selectedFile.size);
      setSpeed(0);
      setEta(null);
      resetProcessingStats();
      setStatus("processing");
      setMessage(
        "Upload complete. Video processing has started."
      );
    } catch (error) {
      console.error("Upload error:", error);

      if (
        error instanceof Error &&
        error.message === "Upload cancelled."
      ) {
        setStatus("cancelled");
        setMessage(
          "Upload stopped. Your uploaded chunks are saved and can be resumed."
        );
        return;
      }

      setStatus("error");
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

    setStorageMode("local");

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
                        Encode Speed
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
                      FPS{" "}
                      {processingFps !==
                        null &&
                      Number.isFinite(
                        processingFps
                      )
                        ? processingFps.toFixed(
                            1
                          )
                        : "--"}
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
