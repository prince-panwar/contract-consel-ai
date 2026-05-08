import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@xenova/transformers",
    "onnxruntime-node",
    "mongodb",
  ],
};

export default nextConfig;
