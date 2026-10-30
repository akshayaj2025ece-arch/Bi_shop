import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not use "standalone" on Vercel; Vercel handles serverless function packaging natively.
  // Using "standalone" on Vercel causes ENOENT: no such file or directory, open '.next/next-server.js.nft.json'
  output: process.env.VERCEL ? undefined : "standalone",
  /* ── Package Import Optimization for Lucide & Framer Motion ── */
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "chart.js", "react-chartjs-2"],
  },

  /* ── Image Optimization ── */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  /* ── Headers for Security ── */
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
    ];
  },
};

export default nextConfig;
