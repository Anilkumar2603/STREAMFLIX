import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";

import { prisma } from "../lib/prisma";
import {
  getOriginalObjectKey,
  getStorageMode,
} from "../lib/r2";

import {
  getAvailableEncoders,
  type EncoderInfo,
  type EncoderType,
} from "./detect-encoder";

const execFileAsync = promisify(execFile);

/* =========================================================
   R2 HELPERS
   ========================================================= */

async function downloadOriginalFromR2(
  objectKey: string,
  outputPath: string
) {
  const workerUrl = process.env.R2_WORKER_URL;
  const workerToken = process.env.R2_WORKER_AUTH_TOKEN;

  if (!workerUrl || !workerToken) {
    throw new Error(
      "R2 Worker environment variables are not configured"
    );
  }

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true,
  });

  const temporaryPath = `${outputPath}.download`;

  await fs.rm(temporaryPath, {
    force: true,
  });

  const url =
    `${workerUrl}/object?action=get&key=${encodeURIComponent(
      objectKey
    )}`;

  console.log(
    "Downloading original video from R2 through Worker..."
  );

  console.log(`R2 object: ${objectKey}`);

  try {
    await execFileAsync(
      "curl.exe",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry",
        "3",
        "--retry-delay",
        "1",
        "-H",
        `Authorization: Bearer ${workerToken}`,
        "--output",
        temporaryPath,
        url,
      ],
      {
        maxBuffer: 1024 * 1024 * 10,
      }
    );

    await fs.access(temporaryPath);

    await fs.rm(outputPath, {
      force: true,
    });

    await fs.rename(
      temporaryPath,
      outputPath
    );

    console.log(
      `Original video downloaded: ${outputPath}`
    );
  } catch (error) {
    await fs.rm(temporaryPath, {
      force: true,
    });

    throw new Error(
      `Failed to download original video from R2 through Worker: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
}

async function uploadFileToR2(
  filePath: string,
  objectKey: string,
  contentType: string
) {
  const workerUrl = process.env.R2_WORKER_URL;
  const workerToken = process.env.R2_WORKER_AUTH_TOKEN;

  if (!workerUrl || !workerToken) {
    throw new Error(
      "R2 Worker environment variables are not configured"
    );
  }

  const url =
    `${workerUrl}/object?action=put&key=${encodeURIComponent(
      objectKey
    )}`;

  const fileStats = await fs.stat(filePath);
  const expectedSize = fileStats.size;

  const MAX_ATTEMPTS = 6;

  /*
   * Important:
   *
   * A connection can reset AFTER R2 has already
   * successfully received the complete object.
   *
   * Therefore, before retrying, check whether the
   * object already exists in R2 with the expected size.
   */
    async function isAlreadyUploaded(): Promise<boolean> {
    try {
      const headUrl =
        `${workerUrl}/object?action=head&key=${encodeURIComponent(
          objectKey
        )}`;

      const { stdout } = await execFileAsync(
        "curl.exe",
        [
          "--silent",
          "--show-error",
          "--location",
          "--connect-timeout",
          "30",
          "--max-time",
          "60",

          "-H",
          `Authorization: Bearer ${workerToken}`,

          "-w",
          "\n__HTTP_STATUS__:%{http_code}",

          headUrl,
        ],
        {
          maxBuffer: 1024 * 1024 * 5,
        }
      );

      const marker = "\n__HTTP_STATUS__:";
      const markerIndex = stdout.lastIndexOf(marker);

      if (markerIndex === -1) {
        console.log(
          `R2 HEAD verification returned an unexpected response for ${objectKey}`
        );

        console.log(stdout);

        return false;
      }

      const responseText =
        stdout.slice(0, markerIndex).trim();

      const statusText =
        stdout.slice(
          markerIndex + marker.length
        ).trim();

      const status = Number(statusText);

      console.log(
        `R2 HEAD verification: HTTP ${status} for ${objectKey}`
      );

      console.log(
        `R2 HEAD response: ${responseText}`
      );

      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        console.log(
          `R2 HEAD verification failed with HTTP ${status}`
        );

        return false;
      }

      let data: any;

      try {
        data = JSON.parse(responseText);
      } catch {
        console.log(
          "R2 HEAD returned non-JSON response."
        );

        return false;
      }

      console.log(
        `R2 verification details: exists=${data.exists}, ` +
        `contentLength=${data.contentLength}, ` +
        `expectedSize=${expectedSize}`
      );

      return (
        data.exists === true &&
        Number(data.contentLength) === expectedSize
      );
    } catch (error) {
      console.error(
        `R2 HEAD request failed for ${objectKey}:`
      );

      console.error(
        error instanceof Error
          ? error.message
          : String(error)
      );

      return false;
    }
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    /*
     * Check before every attempt.
     *
     * This handles the case where the previous PUT
     * succeeded but the response was lost.
     */
    if (await isAlreadyUploaded()) {
      console.log(
        `Already uploaded, skipping: ${objectKey}`
      );
      return;
    }

    console.log(
      `Uploading to R2: ${objectKey} ` +
        `(attempt ${attempt}/${MAX_ATTEMPTS})`
    );

    try {
      await execFileAsync(
        "curl.exe",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",

          /*
           * Don't let a stalled connection hang forever.
           */
          "--connect-timeout",
          "30",

          "--max-time",
          "600",

          "-X",
          "PUT",

          "-H",
          `Authorization: Bearer ${workerToken}`,

          "-H",
          `Content-Type: ${contentType}`,

          "--upload-file",
          filePath,

          url,
        ],
        {
          maxBuffer: 1024 * 1024 * 10,
        }
      );

      /*
       * Curl succeeded.
       *
       * Verify the object before continuing.
       */
      if (await isAlreadyUploaded()) {
        console.log(
          `Upload verified: ${objectKey}`
        );
        return;
      }

      throw new Error(
        "Upload command succeeded, but R2 object verification failed."
      );
    } catch (error) {
      console.error(
        `Upload failed: ${objectKey}`
      );

      console.error(
        error instanceof Error
          ? error.message
          : String(error)
      );

      /*
       * One final check is important because the PUT
       * may have completed even though curl reported
       * a connection reset.
       */
      if (await isAlreadyUploaded()) {
        console.log(
          `Upload actually completed despite connection error: ${objectKey}`
        );
        return;
      }

      if (attempt === MAX_ATTEMPTS) {
        throw new Error(
          `Failed to upload ${objectKey} after ${MAX_ATTEMPTS} attempts.`
        );
      }

      /*
       * Exponential backoff:
       *
       * attempt 1 → 2 seconds
       * attempt 2 → 4 seconds
       * attempt 3 → 8 seconds
       * attempt 4 → 16 seconds
       * attempt 5 → 32 seconds
       */
      const delay =
        Math.min(
          2 ** attempt,
          32
        ) * 1000;

      console.log(
        `Retrying ${objectKey} in ${
          delay / 1000
        } seconds...`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, delay)
      );
    }
  }
}

/**
 * Upload only HLS/media files.
 *
 * IMPORTANT:
 * Generated thumbnail.jpg is deliberately excluded.
 *
 * R2 structure:
 *
 * streams/<videoId>/
 *   master.m3u8
 *   0/
 *     playlist.m3u8
 *     init.mp4
 *     segment-000.m4s
 *     ...
 */
async function uploadHlsDirectoryToR2(
  localDir: string,
  objectPrefix: string
) {
  async function walk(currentDir: string) {
    const entries = await fs.readdir(
      currentDir,
      {
        withFileTypes: true,
      }
    );

    for (const entry of entries) {
      const fullPath = path.join(
        currentDir,
        entry.name
      );

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const relativePath = path
        .relative(localDir, fullPath)
        .split(path.sep)
        .join("/");

      /*
       * Only upload files that belong to the HLS output.
       *
       * Generated thumbnail.jpg must NEVER be uploaded
       * as part of the HLS directory.
       */
      const lowerName = entry.name.toLowerCase();

      const isHlsFile =
        lowerName.endsWith(".m3u8") ||
        lowerName.endsWith(".m4s") ||
        lowerName.endsWith(".mp4");

      if (!isHlsFile) {
        console.log(
          `Skipping non-HLS file: ${relativePath}`
        );

        continue;
      }

      const objectKey =
        `${objectPrefix}/${relativePath}`;

      let contentType =
        "application/octet-stream";

      if (lowerName.endsWith(".m3u8")) {
        contentType =
          "application/vnd.apple.mpegurl";
      } else if (lowerName.endsWith(".m4s")) {
        contentType =
          "video/iso.segment";
      } else if (lowerName.endsWith(".mp4")) {
        contentType =
          "video/mp4";
      }

      await uploadFileToR2(
        fullPath,
        objectKey,
        contentType
      );
    }
  }

  await walk(localDir);
}

/**
 * Delete a private object from R2 through the Worker.
 *
 * We intentionally use curl.exe because direct Node HTTPS
 * requests to the R2 infrastructure are blocked by the
 * current PC's corporate TLS/proxy environment.
 */
async function deleteObjectFromR2(
  objectKey: string
) {
  const workerUrl = process.env.R2_WORKER_URL;
  const workerToken = process.env.R2_WORKER_AUTH_TOKEN;

  if (!workerUrl || !workerToken) {
    throw new Error(
      "R2 Worker environment variables are not configured"
    );
  }

  const url =
    `${workerUrl}/object?action=delete&key=${encodeURIComponent(
      objectKey
    )}`;

  console.log(
    `Deleting original from R2: ${objectKey}`
  );

  await execFileAsync(
    "curl.exe",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry",
      "3",
      "--retry-delay",
      "1",
      "-X",
      "DELETE",
      "-H",
      `Authorization: Bearer ${workerToken}`,
      url,
    ],
    {
      maxBuffer: 1024 * 1024 * 5,
    }
  );

  console.log(
    `Original deleted from R2: ${objectKey}`
  );
}

/**
 * Delete the temporary local source file.
 *
 * This is intentionally called only after successful processing.
 */
async function deleteLocalOriginal(
  inputPath: string
) {
  try {
    await fs.rm(inputPath, {
      force: true,
    });

    console.log(
      `Local temporary original deleted: ${inputPath}`
    );
  } catch (error) {
    console.error(
      "Failed to delete local temporary original:",
      error
    );
  }
}

/* =========================================================
   VIDEO PROBE
   ========================================================= */

type ProbeResult = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
  }>;

  format?: {
    duration?: string;
  };
};

type Variant = {
  name: string;
  width: number;
  height: number;
  bitrate: string;
  maxrate: string;
  bufsize: string;
};

type FFmpegProgress = {
  outTimeSeconds?: number;
  fps?: number;
  speed?: number;
};

const ALL_VARIANTS: Variant[] = [
  {
    name: "1080p",
    width: 1920,
    height: 1080,
    bitrate: "5000k",
    maxrate: "5350k",
    bufsize: "7500k",
  },
  {
    name: "720p",
    width: 1280,
    height: 720,
    bitrate: "3000k",
    maxrate: "3210k",
    bufsize: "4500k",
  },
  {
    name: "480p",
    width: 854,
    height: 480,
    bitrate: "1500k",
    maxrate: "1600k",
    bufsize: "2250k",
  },
  {
    name: "360p",
    width: 640,
    height: 360,
    bitrate: "800k",
    maxrate: "856k",
    bufsize: "1200k",
  },
];

async function getVideoInfo(
  inputPath: string
) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      inputPath,
    ]
  );

  const probe: ProbeResult =
    JSON.parse(stdout);

  const videoStream =
    probe.streams?.find(
      (stream) =>
        stream.codec_type === "video"
    );

  const audioStream =
    probe.streams?.find(
      (stream) =>
        stream.codec_type === "audio"
    );

  if (!videoStream) {
    throw new Error(
      "No video stream found"
    );
  }

  const width =
    videoStream.width ?? 0;

  const height =
    videoStream.height ?? 0;

  if (!width || !height) {
    throw new Error(
      "Could not determine video resolution"
    );
  }

  const duration = Number(
    probe.format?.duration ?? 0
  );

  return {
    width,
    height,
    hasAudio: !!audioStream,
    fps:
      videoStream.r_frame_rate ??
      "30/1",

    duration:
      Number.isFinite(duration) &&
      duration > 0
        ? duration
        : null,
  };
}

function getVariants(
  sourceHeight: number
) {
  return ALL_VARIANTS.filter(
    (variant) =>
      variant.height <= sourceHeight
  );
}

/* =========================================================
   FFMPEG
   ========================================================= */

function addEncoderOptions(
  args: string[],
  encoder: EncoderType
) {
  switch (encoder) {
    case "h264_amf":
      args.push(
        "-usage",
        "transcoding",
        "-quality",
        "balanced",
        "-rc",
        "vbr_peak"
      );
      break;

    case "h264_nvenc":
      args.push(
        "-preset",
        "p4",
        "-rc",
        "vbr"
      );
      break;

    case "h264_qsv":
      args.push(
        "-preset",
        "medium"
      );
      break;

    case "libx264":
      args.push(
        "-preset",
        "veryfast",
        "-profile:v",
        "high"
      );
      break;
  }
}

function addVariantVideoOptions(
  args: string[],
  encoder: EncoderType,
  index: number,
  variant: Variant
) {
  args.push(
    `-c:v:${index}`,
    encoder,
    `-b:v:${index}`,
    variant.bitrate,
    `-maxrate:v:${index}`,
    variant.maxrate,
    `-bufsize:v:${index}`,
    variant.bufsize
  );
}

function buildFFmpegArgs(
  inputPath: string,
  outputDir: string,
  variants: Variant[],
  hasAudio: boolean,
  encoder: EncoderInfo
): string[] {
  const filterParts: string[] = [];

  const splitOutputs = variants
    .map(
      (variant) =>
        `[${variant.name}in]`
    )
    .join("");

  filterParts.push(
    `[0:v]split=${variants.length}${splitOutputs}`
  );

  for (const variant of variants) {
    filterParts.push(
      `[${variant.name}in]` +
        `scale=w=${variant.width}:h=${variant.height}:` +
        `force_original_aspect_ratio=decrease:` +
        `force_divisible_by=2` +
        `[${variant.name}out]`
    );
  }

  const filterComplex =
    filterParts.join(";");

  const args: string[] = [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
  ];

  variants.forEach(
  (variant, index) => {
    args.push(
      "-map",
      `[${variant.name}out]`
    );

    addVariantVideoOptions(
      args,
      encoder.encoder,
      index,
      variant
    );
  }
);

if (hasAudio) {
  variants.forEach(() => {
    args.push(
      "-map",
      "0:a:0"
    );
  });
}

addEncoderOptions(
  args,
  encoder.encoder
);

args.push(
  "-force_key_frames",
  "expr:gte(t,n_forced*6)",
  "-sc_threshold",
  "0"
);

if (hasAudio) {
  variants.forEach((_, index) => {
    args.push(
      `-c:a:${index}`,
      "aac",
      `-b:a:${index}`,
      "128k"
    );
  });
}

  args.push(
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "fmp4",
    "-master_pl_name",
    "master.m3u8",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    `${outputDir}/%v/segment-%03d.m4s`
  );

  const variantMap = hasAudio
    ? variants
        .map(
          (variant, index) =>
            `v:${index},a:${index},name:${variants[index].name}`
        )
        .join(" ")
    : variants
        .map(
          (variant, index) =>
            `v:${index},name:${variants[index].name}`
        )
        .join(" ");

  args.push(
    "-var_stream_map",
    variantMap,
    `${outputDir}/%v/playlist.m3u8`
  );

  /*
   * Ask FFmpeg to emit machine-readable progress.
   *
   * This goes to stdout while normal FFmpeg logs
   * continue going to stderr.
   */
  args.push(
    "-progress",
    "pipe:1",
    "-nostats"
  );

  return args;
}

/* =========================================================
   PROGRESS
   ========================================================= */

function parseProgressLine(
  key: string,
  value: string,
  progress: FFmpegProgress
) {
  switch (key) {
    case "out_time_us": {
      const microseconds =
        Number(value);

      if (
        Number.isFinite(microseconds)
      ) {
        progress.outTimeSeconds =
          microseconds / 1_000_000;
      }

      break;
    }

    case "out_time_ms": {
      /*
       * FFmpeg's progress output uses this
       * field in microsecond-scale units in
       * current builds.
       *
       * out_time_us is preferred when available.
       */
      const valueNumber =
        Number(value);

      if (
        progress.outTimeSeconds ===
          undefined &&
        Number.isFinite(valueNumber)
      ) {
        progress.outTimeSeconds =
          valueNumber / 1_000_000;
      }

      break;
    }

    case "fps": {
      const fps = Number(value);

      if (Number.isFinite(fps)) {
        progress.fps = fps;
      }

      break;
    }

    case "speed": {
      const match =
        value.match(
          /^([0-9.]+)x$/
        );

      if (match) {
        const speed =
          Number(match[1]);

        if (Number.isFinite(speed)) {
          progress.speed = speed;
        }
      }

      break;
    }
  }
}

async function updateProcessingProgress(
  videoId: string,
  duration: number,
  progress: FFmpegProgress,
  startedAt: number,
  encoder: EncoderInfo
) {
  if (
    progress.outTimeSeconds ===
      undefined ||
    duration <= 0
  ) {
    return;
  }

  const elapsed =
    (Date.now() - startedAt) /
    1000;

  const percentage =
    Math.min(
      99,
      Math.max(
        0,
        (progress.outTimeSeconds /
          duration) *
          100
      )
    );

  let eta: number | null = null;

  /*
   * Prefer FFmpeg's reported speed.
   *
   * Example:
   *
   * 2.5x realtime
   * 80 second video
   * Remaining 40 seconds
   * 40 / 2.5 = 16 seconds ETA
   */
  if (
    progress.speed !== undefined &&
    progress.speed > 0
  ) {
    const remainingVideoSeconds =
      Math.max(
        0,
        duration -
          progress.outTimeSeconds
      );

    eta =
      remainingVideoSeconds /
      progress.speed;
  }

  await prisma.video.update({
    where: {
      id: videoId,
    },

    data: {
      progress: percentage,
      processingFps:
        progress.fps ?? null,
      processingSpeed:
        progress.speed ?? null,
      processingElapsed: elapsed,
      processingEta: eta,
      processingStage:
        "TRANSCODING",
      encoderUsed:
        encoder.name,
    },
  });
}

/* =========================================================
   ENCODING
   ========================================================= */

async function encodeWithEncoder(
  videoId: string,
  inputPath: string,
  outputDir: string,
  variants: Variant[],
  hasAudio: boolean,
  encoder: EncoderInfo,
  duration: number | null
) {
  await fs.rm(outputDir, {
    recursive: true,
    force: true,
  });

  await fs.mkdir(outputDir, {
    recursive: true,
  });

  /*
   * Reset progress when starting
   * a new encoder attempt.
   */
  await prisma.video.update({
    where: {
      id: videoId,
    },

    data: {
      progress: 0,
      processingFps: null,
      processingSpeed: null,
      processingElapsed: 0,
      processingEta: null,
      processingStage:
        "TRANSCODING",
      encoderUsed:
        encoder.name,
    },
  });

  const ffmpegArgs =
    buildFFmpegArgs(
      inputPath,
      outputDir,
      variants,
      hasAudio,
      encoder
    );

  console.log("");
  console.log(
    "--------------------------------"
  );

  console.log(
    `Trying encoder: ${encoder.name}`
  );

  console.log(
    `FFmpeg codec: ${encoder.encoder}`
  );

  console.log(
    `Hardware: ${
      encoder.hardware
        ? "YES"
        : "NO"
    }`
  );

  console.log(
    "--------------------------------"
  );

  const startedAt =
    Date.now();

  const child = spawn(
    "ffmpeg",
    ffmpegArgs,
    {
      windowsHide: true,
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    }
  );

  let stderrOutput = "";

  child.stderr.on(
    "data",
    (chunk: Buffer) => {
      const text =
        chunk.toString();

      stderrOutput += text;

      /*
       * Keep FFmpeg's normal diagnostic
       * output visible in the worker terminal.
       */
      process.stderr.write(text);
    }
  );

  const progress: FFmpegProgress =
    {};

  let progressUpdateRunning =
    false;

  child.stdout.on(
    "data",
    (chunk: Buffer) => {
      const text =
        chunk.toString();

      const lines =
        text.split(/\r?\n/);

      for (const line of lines) {
        const separator =
          line.indexOf("=");

        if (separator === -1) {
          continue;
        }

        const key =
          line
            .slice(0, separator)
            .trim();

        const value =
          line
            .slice(separator + 1)
            .trim();

        parseProgressLine(
          key,
          value,
          progress
        );

        /*
         * FFmpeg sends progress=continue
         * while processing.
         */
        if (
          key === "progress" &&
          value === "continue" &&
          !progressUpdateRunning
        ) {
          progressUpdateRunning =
            true;

          updateProcessingProgress(
            videoId,
            duration ?? 0,
            progress,
            startedAt,
            encoder
          )
            .catch((error) => {
              console.error(
                "Progress update failed:",
                error
              );
            })
            .finally(() => {
              progressUpdateRunning =
                false;
            });
        }
      }
    }
  );

  /*
   * Also update progress periodically.
   *
   * This gives the database a smooth
   * progress stream even if FFmpeg's
   * progress events arrive irregularly.
   */
  const progressInterval =
    setInterval(() => {
      if (progressUpdateRunning) {
        return;
      }

      progressUpdateRunning =
        true;

      updateProcessingProgress(
        videoId,
        duration ?? 0,
        progress,
        startedAt,
        encoder
      )
        .catch((error) => {
          console.error(
            "Progress update failed:",
            error
          );
        })
        .finally(() => {
          progressUpdateRunning =
            false;
        });
    }, 1000);

  const exitCode:
    | number
    | null =
    await new Promise<
      number | null
    >(
      (resolve, reject) => {
        let settled = false;
        let progressEnded = false;
        let completionTimeout:
          | NodeJS.Timeout
          | null = null;

        const cleanup = () => {
          if (completionTimeout) {
            clearTimeout(
              completionTimeout
            );

            completionTimeout =
              null;
          }

          clearInterval(
            progressInterval
          );
        };

        const finish = (
          code: number | null
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          cleanup();

          console.log(
            `[FFmpeg] Process closed. Encoder=${encoder.name}, exitCode=${code}, progressEnded=${progressEnded}`
          );

          resolve(code);
        };

        const fail = (
          error: Error
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          cleanup();

          reject(error);
        };

        child.on(
          "error",
          (error) => {
            fail(error);
          }
        );

        child.on(
          "close",
          (code) => {
            finish(code);
          }
        );

        /*
         * FFmpeg normally sends progress=end
         * immediately before exiting.
         *
         * If progress=end is received but
         * FFmpeg does not close within 2 minutes,
         * treat it as a finalization hang.
         */
        const originalStdoutListener =
          (chunk: Buffer) => {
            const text =
              chunk.toString();

            if (
              !progressEnded &&
              /(?:^|\r?\n)progress=end(?:\r?\n|$)/.test(
                text
              )
            ) {
              progressEnded =
                true;

              console.log(
                `[FFmpeg] progress=end received. Waiting for process exit. Encoder=${encoder.name}`
              );

              completionTimeout =
                setTimeout(() => {
                  if (settled) {
                    return;
                  }

                  console.error(
                    `[FFmpeg] Process did not exit within 120 seconds after progress=end. Terminating it. Encoder=${encoder.name}`
                  );

                  try {
                    child.kill();
                  } catch (killError) {
                    console.error(
                      "[FFmpeg] Failed to terminate timed-out process:",
                      killError
                    );
                  }

                  fail(
                    new Error(
                      `FFmpeg did not exit within 120 seconds after progress=end (${encoder.name})`
                    )
                  );
                }, 120_000);
            }
          };

        child.stdout.on(
          "data",
          originalStdoutListener
        );
      }
    );

  /*
   * Give the final database update
   * a chance to complete.
   */
  if (exitCode === 0) {
    await prisma.video.update({
      where: {
        id: videoId,
      },

      data: {
        progress: 100,
        processingStage:
          "TRANSCODING_COMPLETE",
        processingElapsed:
          (Date.now() -
            startedAt) /
          1000,
        processingEta: 0,
        encoderUsed:
          encoder.name,
      },
    });

    return;
  }

  throw new Error(
    `FFmpeg exited with code ${exitCode}.\n${stderrOutput}`
  );
}

/* =========================================================
   THUMBNAIL
   ========================================================= */

async function generateThumbnail(
  inputPath: string,
  outputDir: string,
  duration: number | null
) {
  const thumbnailPath =
    path.join(
      outputDir,
      "thumbnail.jpg"
    );

  let timestamp = 0;

  if (
    duration &&
    duration > 0
  ) {
    timestamp = Math.min(
      duration * 0.1,
      Math.max(
        duration - 0.1,
        0
      )
    );
  }

  console.log("");
  console.log(
    "--------------------------------"
  );

  console.log(
    "Generating thumbnail..."
  );

  console.log(
    `Thumbnail timestamp: ${timestamp.toFixed(
      2
    )}s`
  );

  console.log(
    "--------------------------------"
  );

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      timestamp.toFixed(2),
      "-i",
      inputPath,
      "-frames",
      "1",
      "-q",
      "2",
      "-vf",
      "scale=w=640:h=360:force_original_aspect_ratio=decrease",
      thumbnailPath,
    ],
    {
      maxBuffer:
        1024 * 1024 * 5,
    }
  );

  await fs.access(
    thumbnailPath
  );

  console.log(
    `Thumbnail created: ${thumbnailPath}`
  );

  return (
    `/streams/${path.basename(
      outputDir
    )}/thumbnail.jpg`
  );
}

/* =========================================================
   MAIN PROCESSING
   ========================================================= */

export async function processVideo(
  videoId: string
) {
  const video =
    await prisma.video.findUnique(
      {
        where: {
          id: videoId,
        },
      }
    );

  if (!video) {
    throw new Error(
      `Video ${videoId} not found`
    );
  }

  const inputPath =
    path.join(
      process.cwd(),
      "uploads",
      videoId,
      video.originalFile
    );

  const outputDir =
    path.join(
      process.cwd(),
      "streams",
      video.id
    );

  const isR2 =
    getStorageMode() === "r2";

  const originalObjectKey =
    isR2
      ? getOriginalObjectKey(
          video.id,
          video.originalFile
        )
      : null;

  console.log("");
  console.log(
    "================================"
  );

  console.log(
    `Processing: ${video.title}`
  );

  console.log(
    `Video ID: ${videoId}`
  );

  console.log(
    "================================"
  );

  try {
    /* =====================================================
       1. GET SOURCE VIDEO
       ===================================================== */

    if (isR2) {
      await downloadOriginalFromR2(
        originalObjectKey!,
        inputPath
      );
    } else {
      await fs.access(
        inputPath
      );
    }

    console.log(
      "Inspecting source video..."
    );

    /* =====================================================
       2. PROBE SOURCE
       ===================================================== */

    const info =
      await getVideoInfo(
        inputPath
      );

    console.log(
      `Source resolution: ${info.width}x${info.height}`
    );

    console.log(
      `Source FPS: ${info.fps}`
    );

    console.log(
      `Audio: ${
        info.hasAudio
          ? "Yes"
          : "No"
      }`
    );

    console.log(
      `Duration: ${
        info.duration !== null
          ? `${info.duration.toFixed(
              2
            )}s`
          : "Unknown"
      }`
    );

    /* =====================================================
       3. SELECT QUALITIES
       ===================================================== */

    const variants =
      getVariants(
        info.height
      );

    if (
      variants.length === 0
    ) {
      throw new Error(
        `Unsupported source resolution: ${info.width}x${info.height}`
      );
    }

    console.log(
      `Qualities: ${variants
        .map(
          (variant) =>
            variant.name
        )
        .join(", ")}`
    );

    /* =====================================================
       4. ENCODERS
       ===================================================== */

    const encoders =
      await getAvailableEncoders();

    if (
      encoders.length === 0
    ) {
      throw new Error(
        "No usable video encoders found."
      );
    }

    console.log("");
    console.log(
      "================================"
    );

    console.log(
      "ENCODER FALLBACK CHAIN"
    );

    console.log(
      "================================"
    );

    encoders.forEach(
      (encoder, index) => {
        console.log(
          `${index + 1}. ${encoder.name} (${encoder.encoder})`
        );
      }
    );

    console.log(
      "================================"
    );

    let successfulEncoder:
      | EncoderInfo
      | null = null;

    let lastError:
      | unknown = null;

    /* =====================================================
       5. TRANSCODE
       ===================================================== */

    for (
      let index = 0;
      index < encoders.length;
      index++
    ) {
      const encoder =
        encoders[index];

      console.log("");
      console.log(
        "================================"
      );

      console.log(
        `ENCODER ATTEMPT ${
          index + 1
        }/${encoders.length}`
      );

      console.log(
        `Encoder: ${encoder.name}`
      );

      console.log(
        "================================"
      );

      try {
        await encodeWithEncoder(
          videoId,
          inputPath,
          outputDir,
          variants,
          info.hasAudio,
          encoder,
          info.duration
        );

        successfulEncoder =
          encoder;

        console.log("");
        console.log(
          `SUCCESS: ${encoder.name}`
        );

        break;
      } catch (error) {
        lastError = error;

        console.error("");
        console.error(
          `FAILED: ${encoder.name}`
        );

        if (
          error instanceof Error
        ) {
          console.error(
            error.message
          );
        } else {
          console.error(
            error
          );
        }

        if (
          index <
          encoders.length - 1
        ) {
          console.log("");
          console.log(
            "Falling back to next encoder..."
          );
        }
      }
    }

    if (
      !successfulEncoder
    ) {
      throw (
        lastError ??
        new Error(
          "All video encoders failed."
        )
      );
    }

    /* =====================================================
       6. GENERATE LOCAL FALLBACK THUMBNAIL
       ===================================================== */

    await prisma.video.update({
      where: {
        id: videoId,
      },

      data: {
        processingStage:
          "GENERATING_THUMBNAIL",
        processingEta: null,
      },
    });

    let generatedThumbnailPath:
      | string
      | null = null;

    try {
      generatedThumbnailPath =
        await generateThumbnail(
          inputPath,
          outputDir,
          info.duration
        );
    } catch (
      thumbnailError
    ) {
      console.error("");
      console.error(
        "Thumbnail generation failed."
      );

      console.error(
        thumbnailError
      );

      console.error(
        "Continuing without thumbnail."
      );
    }

    /* =====================================================
       7. UPLOAD HLS ONLY
       ===================================================== */

    if (isR2) {
      await prisma.video.update({
        where: {
          id: videoId,
        },

        data: {
          processingStage:
            "UPLOADING_TO_R2",
          processingEta: null,
        },
      });

      console.log("");
      console.log(
        "================================"
      );

      console.log(
        "UPLOADING HLS MEDIA TO R2"
      );

      console.log(
        "================================"
      );

      await uploadHlsDirectoryToR2(
        outputDir,
        `streams/${videoId}`
      );

      console.log("");
      console.log(
        "R2 HLS upload completed successfully."
      );

      /*
       * IMPORTANT:
       *
       * thumbnail.jpg was generated locally,
       * but uploadHlsDirectoryToR2() deliberately
       * skipped it.
       *
       * The admin-selected thumbnail will be
       * handled separately by the thumbnail API.
       */
    }

    /* =====================================================
       8. MARK VIDEO READY
       ===================================================== */

    await prisma.video.update({
      where: {
        id: videoId,
      },

      data: {
        status: "READY",

        progress: 100,

        streamPath:
          isR2
            ? `/media/streams/${videoId}/master.m3u8`
            : `/streams/${videoId}/master.m3u8`,

        /*
         * DO NOT overwrite thumbnailPath in R2 mode.
         *
         * If an admin-selected thumbnail already exists,
         * preserve it.
         *
         * If there is no custom thumbnail, the generated
         * thumbnail remains a local processing artifact
         * for now. The R2 thumbnail architecture is handled
         * separately.
         */
        ...(isR2
          ? {}
          : {
              thumbnailPath:
                generatedThumbnailPath,
            }),

        duration:
          info.duration,

        processingStage:
          "READY",

        processingEta: 0,

        encoderUsed:
          successfulEncoder.name,
      },
    });

    console.log("");
    console.log(
      "================================"
    );

    console.log(
      `READY: ${video.title}`
    );

    console.log(
      `Qualities: ${variants
        .map(
          (variant) =>
            variant.name
        )
        .join(", ")}`
    );

    console.log(
      `Stream: ${
        isR2
          ? `/media/streams/${videoId}/master.m3u8`
          : `/streams/${videoId}/master.m3u8`
      }`
    );

    console.log(
      `Thumbnail: ${
        isR2
          ? video.thumbnailPath ??
            "Admin thumbnail not selected"
          : generatedThumbnailPath ??
            "Not generated"
      }`
    );

    console.log(
      `Encoder: ${successfulEncoder.name}`
    );

    console.log(
      "================================"
    );

    /* =====================================================
       9. DELETE ORIGINAL FROM R2
       ===================================================== */

    if (
      isR2 &&
      originalObjectKey
    ) {
      try {
        /*
         * At this point:
         *
         * 1. FFmpeg succeeded
         * 2. HLS upload succeeded
         * 3. Database says READY
         *
         * Therefore the original is no longer
         * required for normal playback.
         */
        await deleteObjectFromR2(
          originalObjectKey
        );
      } catch (deleteError) {
        /*
         * Do NOT mark the video failed merely because
         * cleanup failed.
         *
         * The video is already successfully processed.
         * The original will simply remain in R2 until
         * cleanup succeeds later.
         */
        console.error("");
        console.error(
          "WARNING: HLS processing succeeded, but original R2 object could not be deleted."
        );

        console.error(
          deleteError
        );
      }
    }

    /* =====================================================
       10. DELETE LOCAL TEMPORARY ORIGINAL
       ===================================================== */

    if (isR2) {
      await deleteLocalOriginal(
        inputPath
      );
    }
  } catch (error) {
    console.error("");
    console.error(
      "================================"
    );

    console.error(
      `PROCESSING FAILED: ${video.title}`
    );

    console.error(
      error
    );

    console.error(
      "================================"
    );

    try {
      await prisma.video.update({
        where: {
          id: videoId,
        },

        data: {
          status: "FAILED",
          processingStage:
            "FAILED",
          processingEta: null,
        },
      });
    } catch (dbError) {
      console.error(
        "Failed to update video status:",
        dbError
      );
    }

    /*
     * IMPORTANT:
     *
     * We intentionally do NOT delete the R2 original
     * when processing fails.
     *
     * It remains available for retry/reprocessing.
     */
    throw error;
  }
}
/* =========================================================
   RESUME FAILED HLS UPLOAD
   ========================================================= */

/**
 * Resume a video that already finished FFmpeg encoding
 * but failed while uploading HLS files to R2.
 *
 * This does NOT re-encode the video.
 */
export async function resumeFailedVideoUpload(
  videoId: string
) {
  const video =
    await prisma.video.findUnique({
      where: {
        id: videoId,
      },
    });

  if (!video) {
    throw new Error(
      `Video ${videoId} not found`
    );
  }

  const isR2 =
    getStorageMode() === "r2";

  if (!isR2) {
    throw new Error(
      "Resume upload is only available in R2 storage mode."
    );
  }

  const outputDir =
    path.join(
      process.cwd(),
      "streams",
      videoId
    );

  const masterPlaylist =
    path.join(
      outputDir,
      "master.m3u8"
    );

  /*
   * Make sure the previous FFmpeg output still exists.
   */
  try {
    await fs.access(masterPlaylist);
  } catch {
    throw new Error(
      `Existing HLS output was not found at ${outputDir}. ` +
      `The video must be re-encoded.`
    );
  }

  const originalObjectKey =
    getOriginalObjectKey(
      video.id,
      video.originalFile
    );

  console.log("");
  console.log(
    "================================"
  );
  console.log(
    "RESUMING FAILED VIDEO UPLOAD"
  );
  console.log(
    "================================"
  );
  console.log(
    `Video: ${video.title}`
  );
  console.log(
    `Video ID: ${videoId}`
  );
  console.log(
    `HLS directory: ${outputDir}`
  );
  console.log(
    "FFmpeg will NOT run again."
  );
  console.log(
    "================================"
  );

  try {
    /*
     * Put the video back into processing state.
     */
    await prisma.video.update({
      where: {
        id: videoId,
      },
      data: {
        status: "PROCESSING",
        processingStage:
          "UPLOADING_TO_R2",
        processingEta: null,
      },
    });

    /*
     * Upload whatever is missing.
     *
     * uploadFileToR2() now checks R2 first,
     * so already-uploaded segments are skipped.
     */
    await uploadHlsDirectoryToR2(
      outputDir,
      `streams/${videoId}`
    );

    console.log("");
    console.log(
      "R2 HLS upload completed successfully."
    );

    /*
     * Recover duration if it isn't already stored.
     */
    let duration =
      video.duration;

    if (
      duration === null ||
      duration === undefined
    ) {
      const inputPath =
        path.join(
          process.cwd(),
          "uploads",
          videoId,
          video.originalFile
        );

      try {
        await fs.access(inputPath);

        const info =
          await getVideoInfo(
            inputPath
          );

        duration =
          info.duration;
      } catch {
        /*
         * The original isn't required for
         * completing the upload.
         *
         * Keep the existing database value
         * if probing isn't possible.
         */
      }
    }

    /*
     * Mark the video READY.
     */
    await prisma.video.update({
      where: {
        id: videoId,
      },
      data: {
        status: "READY",

        progress: 100,

        streamPath:
          `/media/streams/${videoId}/master.m3u8`,

        ...(duration !== null &&
        duration !== undefined
          ? {
              duration,
            }
          : {}),

        processingStage:
          "READY",

        processingEta: 0,
      },
    });

    console.log("");
    console.log(
      "================================"
    );
    console.log(
      `READY: ${video.title}`
    );
    console.log(
      `Stream: /media/streams/${videoId}/master.m3u8`
    );
    console.log(
      "================================"
    );

    /*
     * Delete original from R2 only after
     * everything has succeeded.
     */
    try {
      await deleteObjectFromR2(
        originalObjectKey
      );

      console.log(
        "Original deleted from R2."
      );
    } catch (deleteError) {
      console.error(
        "WARNING: HLS upload succeeded, but original R2 object could not be deleted."
      );

      console.error(
        deleteError
      );
    }

    /*
     * Delete local temporary original.
     */
    await deleteLocalOriginal(
      path.join(
        process.cwd(),
        "uploads",
        videoId,
        video.originalFile
      )
    );
  } catch (error) {
    console.error("");
    console.error(
      "================================"
    );
    console.error(
      `RESUME UPLOAD FAILED: ${video.title}`
    );
    console.error(
      error
    );
    console.error(
      "================================"
    );

    await prisma.video.update({
      where: {
        id: videoId,
      },
      data: {
        status: "FAILED",
        processingStage:
          "FAILED",
        processingEta: null,
      },
    });

    throw error;
  }
}
