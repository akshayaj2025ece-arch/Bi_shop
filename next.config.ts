import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not use "standalone" on Vercel; Vercel handles serverless function packaging natively.
  // Using "standalone" on Vercel causes ENOENT: no such file or directory, open '.next/next-server.js.nft.json'
  output: process.env.VERCEL ? undefined : "standalone",

  /* ── Package Import Optimization for Lucide, Charts & Framer Motion ── */
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "chart.js",
      "react-chartjs-2",
      "sonner",
    ],
  },

  /* ── Modern Image Optimization (AVIF + WebP) ── */
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  /* ── Security & Aggressive Static Caching Headers ── */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
      {
        source: "/hero/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.(svg|jpg|jpeg|png|webp|avif|ico|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
