import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type EncoderType =
  | "h264_amf"
  | "h264_nvenc"
  | "h264_qsv"
  | "libx264";

export type EncoderInfo = {
  encoder: EncoderType;
  name: string;
  hardware: boolean;
};

const candidates: EncoderInfo[] = [
  {
    encoder: "h264_amf",
    name: "AMD AMF",
    hardware: true,
  },
  {
    encoder: "h264_nvenc",
    name: "NVIDIA NVENC",
    hardware: true,
  },
  {
    encoder: "h264_qsv",
    name: "Intel Quick Sync",
    hardware: true,
  },
  {
    encoder: "libx264",
    name: "CPU libx264",
    hardware: false,
  },
];

async function isEncoderListed(
  encoder: EncoderType
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-encoders",
    ]);

    return stdout.includes(` ${encoder}`);
  } catch {
    return false;
  }
}

async function testHardwareEncoder(
  encoder: EncoderType
): Promise<boolean> {
  try {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30",
      "-t",
      "1",
      "-an",
      "-c:v",
      encoder,
    ];

    if (encoder === "h264_amf") {
      args.push(
        "-usage",
        "transcoding",
        "-quality",
        "balanced",
        "-rc",
        "vbr_peak"
      );
    }

    if (encoder === "h264_nvenc") {
      args.push(
        "-preset",
        "p4",
        "-rc",
        "vbr"
      );
    }

    if (encoder === "h264_qsv") {
      args.push(
        "-preset",
        "medium"
      );
    }

    args.push(
      "-f",
      "null",
      "-"
    );

    await execFileAsync("ffmpeg", args, {
      
    timeout: 3000,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 5,
  
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Returns every encoder that is actually usable on this machine.
 *
 * Order is important:
 *
 * AMD → NVIDIA → Intel → CPU
 */
export async function getAvailableEncoders(): Promise<EncoderInfo[]> {
  console.log("");
  console.log("================================");
  console.log("DETECTING AVAILABLE ENCODERS");
  console.log("================================");

  const available: EncoderInfo[] = [];

  for (const candidate of candidates) {
    if (candidate.encoder === "libx264") {
      console.log("CPU libx264: AVAILABLE");
      available.push(candidate);
      continue;
    }

    console.log(`Checking ${candidate.name}...`);

    const listed = await isEncoderListed(
      candidate.encoder
    );

    if (!listed) {
      console.log(
        `  ${candidate.encoder}: not available in FFmpeg`
      );
      continue;
    }

    console.log(
      `  ${candidate.encoder}: listed by FFmpeg`
    );

    console.log("  Testing actual encoder...");

    const working = await testHardwareEncoder(
      candidate.encoder
    );

    if (!working) {
      console.log(
        `  ${candidate.name}: unavailable on this system`
      );
      continue;
    }

    console.log(
      `  ${candidate.name}: AVAILABLE`
    );

    available.push(candidate);
  }

  console.log("");
  console.log("Available encoders:");

  for (const encoder of available) {
    console.log(
      `  - ${encoder.name} (${encoder.encoder})`
    );
  }

  console.log("================================");

  return available;
}

/**
 * Returns the best available encoder.
 */
export async function detectEncoder(): Promise<EncoderInfo> {
  const available = await getAvailableEncoders();

  if (available.length === 0) {
    throw new Error(
      "No usable video encoder was found."
    );
  }

  return available[0];
}