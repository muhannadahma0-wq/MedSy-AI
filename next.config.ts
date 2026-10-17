import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // pdf-parse (v2, backed by pdfjs-dist) resolves its worker at runtime and
  // must not be bundled by webpack/turbopack; pdfkit ships binary font data
  // and is equally happier as a plain Node dependency.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "pdfkit"],
};

export default nextConfig;
