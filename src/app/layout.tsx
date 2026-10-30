import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Tamil } from "next/font/google";
import { Providers } from "@/components/providers/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansTamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-noto-sans-tamil",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BISHOP — Smart Bakery & Hotel Management",
    template: "%s | BISHOP",
  },
  description:
    "Premium bakery and hotel management software. Manage orders, inventory, employees and analytics — all in one place.",
  keywords: [
    "bakery management",
    "hotel management",
    "POS software",
    "restaurant software",
    "inventory management",
  ],
  authors: [{ name: "BISHOP" }],
  icons: {
    icon: [
      { url: "/bishop-icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/bishop-icon.svg",
    apple: "/bishop-icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#22c560",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${notoSansTamil.variable} h-full`}>
      <body className="min-h-dvh flex flex-col antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
