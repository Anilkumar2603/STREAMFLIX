import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/videos/[id]/thumbnail": [
      "./node_modules/ffmpeg-static/**/*",
    ],
  },
};

export default nextConfig;
