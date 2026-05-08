import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "@napi-rs/canvas",
    "@xenova/transformers",
    "onnxruntime-node",
    "mongodb",
  ],
};

export default nextConfig;
