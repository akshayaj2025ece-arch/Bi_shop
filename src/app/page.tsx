"use client";

import { motion } from "framer-motion";
import { useState, useEffect, memo } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useLanguageStore } from "@/stores/language-store";
import {
  BarChart3,
  ArrowRight,
  Sparkles,
  Languages,
  MapPin,
  Clock,
  Utensils,
  Store,
  User,
} from "lucide-react";
import Link from "next/link";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";

const carouselItems = [
  { img: "/hero/biriyani.webp", alt: "Biriyani" },
  { img: "/hero/cake.webp", alt: "Fresh Cake" },
  { img: "/hero/filtercoffee.webp", alt: "Filter Coffee" },
  { img: "/hero/parotta.webp", alt: "Parotta" },
  { img: "/hero/meals.webp", alt: "Meals" },
  { img: "/hero/puff.webp", alt: "Bakery Puff" },
  { img: "/hero/tea.webp", alt: "Tea" },
  { img: "/hero/noodles.webp", alt: "Noodles" },
  { img: "/hero/croissant.webp", alt: "Croissant" },
  { img: "/hero/friedrice.webp", alt: "Fried Rice" },
  { img: "/hero/hot-bev.webp", alt: "Hot Beverage" },
  { img: "/hero/cold-bev.webp", alt: "Cold Drink" },
];

const DESKTOP_WAVE_X = [
  10.0, 14.03, 18.51, 23.43, 28.67, 34.04, 39.4, 44.65, 49.78, 54.83, 59.84, 64.86, 69.93, 75.1, 80.39, 85.77, 91.12, 96.27, 101.05, 105.37, 109.26, 112.74, 115.99, 119.96, 125.09, 129.85, 133.35, 136.05, 138.23, 140.0, 140.0, 140.0, 140.0, 140.0, 141.77, 143.95, 146.65, 150.15, 154.91, 160.04, 164.01, 167.26, 170.74, 174.63, 178.95, 183.73, 188.88, 194.23, 199.61, 204.9, 210.07, 215.14, 220.16, 225.17, 230.22, 235.35, 240.6, 245.96, 251.33, 256.57, 261.49, 265.97, 270.0, 270.0, 265.97, 261.49, 256.57, 251.33, 245.96, 240.6, 235.35, 230.22, 225.17, 220.16, 215.14, 210.07, 204.9, 199.61, 194.23, 188.88, 183.73, 178.95, 174.63, 170.74, 167.26, 164.01, 160.04, 154.91, 150.15, 146.65, 143.95, 141.77, 140.0, 140.0, 140.0, 140.0, 138.23, 136.05, 133.35, 129.85, 125.09, 119.96, 115.99, 112.74, 109.26, 105.37, 101.05, 96.27, 91.12, 85.77, 80.39, 75.1, 69.93, 64.86, 59.84, 54.83, 49.78, 44.65, 39.4, 34.04, 28.67, 23.43, 18.51, 14.03, 10.0
];

const DESKTOP_WAVE_Y = [
  50.0, 46.42, 43.44, 41.25, 40.03, 39.77, 40.36, 41.57, 43.2, 45.08, 47.07, 49.04, 50.85, 52.36, 53.39, 53.71, 53.14, 51.58, 49.1, 45.9, 42.16, 38.06, 33.76, 30.15, 28.89, 31.25, 35.32, 39.99, 44.91, 50.0, 50.0, 50.0, 50.0, 50.0, 55.09, 60.01, 64.68, 68.75, 71.11, 69.85, 66.24, 61.94, 57.84, 54.1, 50.9, 48.42, 46.86, 46.29, 46.61, 47.64, 49.15, 50.96, 52.93, 54.92, 56.8, 58.43, 59.64, 60.23, 59.97, 58.75, 56.56, 53.58, 50.0, 50.0, 53.58, 56.56, 58.75, 59.97, 60.23, 59.64, 58.43, 56.8, 54.92, 52.93, 50.96, 49.15, 47.64, 46.61, 46.29, 46.86, 48.42, 50.9, 54.1, 57.84, 61.94, 66.24, 69.85, 71.11, 68.75, 64.68, 60.01, 55.09, 50.0, 50.0, 50.0, 50.0, 44.91, 39.99, 35.32, 31.25, 28.89, 30.15, 33.76, 38.06, 42.16, 45.9, 49.1, 51.58, 53.14, 53.71, 53.39, 52.36, 50.85, 49.04, 47.07, 45.08, 43.2, 41.57, 40.36, 39.77, 40.03, 41.25, 43.44, 46.42, 50.0
];

const DESKTOP_WAVE_TIMES = [
  0.0, 0.0121, 0.0241, 0.0362, 0.0483, 0.0603, 0.0724, 0.0845, 0.0966, 0.1086, 0.1207, 0.1328, 0.1448, 0.1569, 0.169, 0.181, 0.1931, 0.2052, 0.2172, 0.2293, 0.2414, 0.2534, 0.2655, 0.2776, 0.2897, 0.3017, 0.3138, 0.3259, 0.3379, 0.35, 0.38, 0.42, 0.45, 0.45, 0.4621, 0.4741, 0.4862, 0.4983, 0.5103, 0.5224, 0.5345, 0.5466, 0.5586, 0.5707, 0.5828, 0.5948, 0.6069, 0.619, 0.631, 0.6431, 0.6552, 0.6672, 0.6793, 0.6914, 0.7034, 0.7155, 0.7276, 0.7397, 0.7517, 0.7638, 0.7759, 0.7879, 0.8, 0.8, 0.8034, 0.8069, 0.8103, 0.8138, 0.8172, 0.8207, 0.8241, 0.8276, 0.831, 0.8345, 0.8379, 0.8414, 0.8448, 0.8483, 0.8517, 0.8552, 0.8586, 0.8621, 0.8655, 0.869, 0.8724, 0.8759, 0.8793, 0.8828, 0.8862, 0.8897, 0.8931, 0.8966, 0.9, 0.92, 0.94, 0.94, 0.9421, 0.9441, 0.9462, 0.9483, 0.9503, 0.9524, 0.9545, 0.9566, 0.9586, 0.9607, 0.9628, 0.9648, 0.9669, 0.969, 0.971, 0.9731, 0.9752, 0.9772, 0.9793, 0.9814, 0.9834, 0.9855, 0.9876, 0.9897, 0.9917, 0.9938, 0.9959, 0.9979, 1.0
];

const MOBILE_WAVE_X = [
  50.0, 47.71, 45.67, 43.95, 42.62, 41.76, 41.37, 41.43, 41.9, 42.68, 43.72, 44.94, 46.3, 47.75, 49.24, 50.76, 52.25, 53.7, 55.06, 56.28, 57.32, 58.1, 58.57, 58.63, 58.24, 57.38, 56.05, 54.33, 52.29, 50.0, 50.0, 50.0, 50.0, 50.0, 47.71, 45.67, 43.95, 42.62, 41.76, 41.37, 41.43, 41.9, 42.68, 43.72, 44.94, 46.3, 47.75, 49.24, 50.76, 52.25, 53.7, 55.06, 56.28, 57.32, 58.1, 58.57, 58.63, 58.24, 57.38, 56.05, 54.33, 52.29, 50.0, 50.0, 52.29, 54.33, 56.05, 57.38, 58.24, 58.63, 58.57, 58.1, 57.32, 56.28, 55.06, 53.7, 52.25, 50.76, 49.24, 47.75, 46.3, 44.94, 43.72, 42.68, 41.9, 41.43, 41.37, 41.76, 42.62, 43.95, 45.67, 47.71, 50.0, 50.0, 50.0, 50.0, 52.29, 54.33, 56.05, 57.38, 58.24, 58.63, 58.57, 58.1, 57.32, 56.28, 55.06, 53.7, 52.25, 50.76, 49.24, 47.75, 46.3, 44.94, 43.72, 42.68, 41.9, 41.43, 41.37, 41.76, 42.62, 43.95, 45.67, 47.71, 50.0
];

const MOBILE_WAVE_Y = [
  10.0, 12.5, 15.2, 18.11, 21.23, 24.5, 27.86, 31.25, 34.6, 37.89, 41.12, 44.28, 47.38, 50.45, 53.48, 56.52, 59.55, 62.62, 65.72, 68.88, 72.11, 75.4, 78.75, 82.14, 85.5, 88.77, 91.89, 94.8, 97.5, 100.0, 100.0, 100.0, 100.0, 100.0, 102.5, 105.2, 108.11, 111.23, 114.5, 117.86, 121.25, 124.6, 127.89, 131.12, 134.28, 137.38, 140.45, 143.48, 146.52, 149.55, 152.62, 155.72, 158.88, 162.11, 165.4, 168.75, 172.14, 175.5, 178.77, 181.89, 184.8, 187.5, 190.0, 190.0, 187.5, 184.8, 181.89, 178.77, 175.5, 172.14, 168.75, 165.4, 162.11, 158.88, 155.72, 152.62, 149.55, 146.52, 143.48, 140.45, 137.38, 134.28, 131.12, 127.89, 124.6, 121.25, 117.86, 114.5, 111.23, 108.11, 105.2, 102.5, 100.0, 100.0, 100.0, 100.0, 97.5, 94.8, 91.89, 88.77, 85.5, 82.14, 78.75, 75.4, 72.11, 68.88, 65.72, 62.62, 59.55, 56.52, 53.48, 50.45, 47.38, 44.28, 41.12, 37.89, 34.6, 31.25, 27.86, 24.5, 21.23, 18.11, 15.2, 12.5, 10.0
];

const MOBILE_WAVE_TIMES = [
  0.0, 0.0121, 0.0241, 0.0362, 0.0483, 0.0603, 0.0724, 0.0845, 0.0966, 0.1086, 0.1207, 0.1328, 0.1448, 0.1569, 0.169, 0.181, 0.1931, 0.2052, 0.2172, 0.2293, 0.2414, 0.2534, 0.2655, 0.2776, 0.2897, 0.3017, 0.3138, 0.3259, 0.3379, 0.35, 0.38, 0.42, 0.45, 0.45, 0.4621, 0.4741, 0.4862, 0.4983, 0.5103, 0.5224, 0.5345, 0.5466, 0.5586, 0.5707, 0.5828, 0.5948, 0.6069, 0.619, 0.631, 0.6431, 0.6552, 0.6672, 0.6793, 0.6914, 0.7034, 0.7155, 0.7276, 0.7397, 0.7517, 0.7638, 0.7759, 0.7879, 0.8, 0.8, 0.8034, 0.8069, 0.8103, 0.8138, 0.8172, 0.8207, 0.8241, 0.8276, 0.831, 0.8345, 0.8379, 0.8414, 0.8448, 0.8483, 0.8517, 0.8552, 0.8586, 0.8621, 0.8655, 0.869, 0.8724, 0.8759, 0.8793, 0.8828, 0.8862, 0.8897, 0.8931, 0.8966, 0.9, 0.92, 0.94, 0.94, 0.9421, 0.9441, 0.9462, 0.9483, 0.9503, 0.9524, 0.9545, 0.9566, 0.9586, 0.9607, 0.9628, 0.9648, 0.9669, 0.969, 0.971, 0.9731, 0.9752, 0.9772, 0.9793, 0.9814, 0.9834, 0.9855, 0.9876, 0.9897, 0.9917, 0.9938, 0.9959, 0.9979, 1.0
];

// Memoized features section to isolate the 2.8s interval state and prevent re-rendering the whole page
const FeaturesSection = memo(function FeaturesSection({
  t,
}: {
  t: (typeof DASHBOARD_TRANSLATIONS)["en"]["landingPage"];
}) {
  const [activeFeatureIndex, setActiveFeatureIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeatureIndex((prev) => (prev + 1) % 4);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  const customerFeaturesList = [
    {
      index: 0,
      icon: MapPin,
      title: t.trackLocationTitle,
      description: t.trackLocationDesc,
    },
    {
      index: 1,
      icon: Clock,
      title: t.saveTimeTitle,
      description: t.saveTimeDesc,
    },
  ];

  const shopkeeperFeaturesList = [
    {
      index: 2,
      icon: Utensils,
      title: t.menuManagementTitle,
      description: t.menuManagementDesc,
    },
    {
      index: 3,
      icon: BarChart3,
      title: t.liveAnalyticsTitle,
      description: t.liveAnalyticsDesc,
    },
  ];

  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 relative">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-950 mb-3 tracking-tight">
            {t.everythingYouNeed}
          </h2>
          <p className="text-slate-600 text-base sm:text-xl max-w-xl mx-auto font-medium">
            {t.everythingDesc}
          </p>
        </div>

        {/* Animated Connecting Beam Bar Across All Features */}
        <div className="relative mb-10 hidden md:block">
          <div className="h-1 w-full bg-slate-200/70 rounded-full overflow-hidden">
            <motion.div
              animate={{
                x: ["0%", "75%", "0%"],
              }}
              transition={{
                duration: 8,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="h-full w-1/4 bg-gradient-to-r from-mint-300 via-mint-500 to-mint-400 rounded-full shadow-sm will-change-transform"
            />
          </div>
        </div>

        {/* Features Layout Split: CUSTOMER vs SHOPKEEPER */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12">
          {/* ── CUSTOMER FEATURES ── */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 mb-2 pb-2 border-b border-mint-200/70">
              <div className="h-7 w-7 rounded-lg bg-mint-100 flex items-center justify-center">
                <User className="h-4 w-4 text-mint-700" />
              </div>
              <h3 className="text-sm font-extrabold tracking-wider text-mint-800 uppercase">
                {t.customerSectionTitle}
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {customerFeaturesList.map((feature) => {
                const isActive = activeFeatureIndex === feature.index;
                const IconComp = feature.icon;

                return (
                  <motion.div
                    key={feature.title}
                    onMouseEnter={() => setActiveFeatureIndex(feature.index)}
                    animate={{
                      scale: isActive ? 1.025 : 1,
                      y: isActive ? -4 : 0,
                    }}
                    transition={{ duration: 0.3 }}
                    className={`relative bg-white rounded-2xl p-5 border transition-all duration-300 cursor-pointer ${
                      isActive
                        ? "border-mint-400 bg-gradient-to-b from-mint-50/50 to-white shadow-lg shadow-mint-500/10 ring-2 ring-mint-400/20"
                        : "border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-sm"
                    }`}
                  >
                    <div
                      className={`h-11 w-11 rounded-xl flex items-center justify-center mb-3.5 transition-colors ${
                        isActive
                          ? "bg-mint-500 text-white shadow-md shadow-mint-500/30 scale-110"
                          : "bg-mint-50 text-mint-700 border border-mint-100"
                      }`}
                    >
                      <IconComp className="h-5 w-5" />
                    </div>
                    <h4 className="text-base font-bold text-slate-900 mb-1.5">
                      {feature.title}
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
                      {feature.description}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* ── SHOPKEEPER FEATURES ── */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 mb-2 pb-2 border-b border-mint-200/70">
              <div className="h-7 w-7 rounded-lg bg-mint-100 flex items-center justify-center">
                <Store className="h-4 w-4 text-mint-700" />
              </div>
              <h3 className="text-sm font-extrabold tracking-wider text-mint-800 uppercase">
                {t.shopkeeperSectionTitle}
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {shopkeeperFeaturesList.map((feature) => {
                const isActive = activeFeatureIndex === feature.index;
                const IconComp = feature.icon;

                return (
                  <motion.div
                    key={feature.title}
                    onMouseEnter={() => setActiveFeatureIndex(feature.index)}
                    animate={{
                      scale: isActive ? 1.025 : 1,
                      y: isActive ? -4 : 0,
                    }}
                    transition={{ duration: 0.3 }}
                    className={`relative bg-white rounded-2xl p-5 border transition-all duration-300 cursor-pointer ${
                      isActive
                        ? "border-mint-400 bg-gradient-to-b from-mint-50/50 to-white shadow-lg shadow-mint-500/10 ring-2 ring-mint-400/20"
                        : "border-slate-200/80 shadow-xs hover:border-slate-300 hover:shadow-sm"
                    }`}
                  >
                    <div
                      className={`h-11 w-11 rounded-xl flex items-center justify-center mb-3.5 transition-colors ${
                        isActive
                          ? "bg-mint-500 text-white shadow-md shadow-mint-500/30 scale-110"
                          : "bg-mint-50 text-mint-700 border border-mint-100"
                      }`}
                    >
                      <IconComp className="h-5 w-5" />
                    </div>
                    <h4 className="text-base font-bold text-slate-900 mb-1.5">
                      {feature.title}
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
                      {feature.description}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});

export default function HomePage() {
  const { lang, toggleLang } = useLanguageStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentLang = mounted ? lang || "en" : "en";
  const t = DASHBOARD_TRANSLATIONS[currentLang].landingPage;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-mint-50/60 via-white to-mint-50/40 text-slate-900 transition-colors duration-500 overflow-x-hidden selection:bg-mint-200 selection:text-mint-900">
      {/* ─── Navbar ─── */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-slate-200/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <Image
              src="/bishop-logo.svg"
              alt="BISHOP"
              width={140}
              height={40}
              className="h-9 w-auto object-contain group-hover:scale-105 transition-transform"
              priority
            />
          </Link>

          {/* Navigation Controls & Auth */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language Switch */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLang}
              className="border-mint-200 text-mint-800 hover:bg-mint-100/70 hover:border-mint-300 font-semibold"
              leftIcon={<Languages className="h-4 w-4 text-mint-600" />}
            >
              {currentLang === "en" ? "தமிழ்" : "English"}
            </Button>

            <Link href="/select-role?intent=login" prefetch={false} className="hidden sm:inline-block">
              <Button variant="ghost" size="sm" className="font-bold text-slate-700 hover:text-slate-950">
                {t.signIn}
              </Button>
            </Link>
            <Link href="/select-role?intent=register" prefetch={false}>
              <Button
                size="sm"
                rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
                className="bg-mint-500 hover:bg-mint-600 text-white shadow-md shadow-mint-500/20 font-bold"
              >
                {t.getStarted}
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero Section ─── */}
      <section className="pt-28 sm:pt-36 pb-12 sm:pb-16 px-4 sm:px-6 relative">
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          {/* Prominent BISHOP Logo with 3D Revolving Effect */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center mb-6"
          >
            <div className="relative mb-2 flex flex-col items-center" style={{ perspective: 1000 }}>
              <motion.div
                animate={{
                  rotateY: [0, 360],
                  filter: [
                    "brightness(1) drop-shadow(0 10px 15px rgba(16, 185, 129, 0.25))",
                    "brightness(0.92) drop-shadow(0 4px 8px rgba(16, 185, 129, 0.15))",
                    "brightness(1) drop-shadow(0 10px 15px rgba(16, 185, 129, 0.25))",
                    "brightness(0.92) drop-shadow(0 4px 8px rgba(16, 185, 129, 0.15))",
                    "brightness(1) drop-shadow(0 10px 15px rgba(16, 185, 129, 0.25))",
                  ],
                }}
                transition={{
                  duration: 12,
                  repeat: Infinity,
                  ease: "linear",
                }}
                style={{ transformStyle: "preserve-3d" }}
                className="motion-reduce:animate-none motion-reduce:transform-none"
              >
                <Image
                  src="/bishop-icon.svg"
                  alt="BISHOP"
                  width={80}
                  height={80}
                  className="h-16 sm:h-20 w-auto object-contain"
                  priority
                />
              </motion.div>

              {/* Dynamic 3D Ground Shadow */}
              <motion.div
                animate={{
                  scaleX: [1, 0.35, 1, 0.35, 1],
                  opacity: [0.35, 0.15, 0.35, 0.15, 0.35],
                }}
                transition={{
                  duration: 12,
                  repeat: Infinity,
                  ease: "linear",
                }}
                className="w-12 h-2 bg-emerald-500/30 rounded-full blur-xs mt-1 motion-reduce:hidden"
              />
            </div>

            <span
              className="text-3xl sm:text-4xl font-black text-emerald-600 tracking-tighter drop-shadow-xs"
              style={{ fontFamily: "'Arial Black', sans-serif" }}
            >
              BISHOP
            </span>
          </motion.div>

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="inline-flex items-center gap-2 bg-mint-100/90 text-mint-800 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold mb-6 border border-mint-200 shadow-xs"
          >
            <Sparkles className="h-3.5 w-3.5 text-mint-600" />
            {t.smartBusiness}
          </motion.div>

          {/* Clean Main Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-950 mb-5 leading-[1.12]"
          >
            {t.welcomeToBishop}
          </motion.h1>

          {/* Connecting Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-lg sm:text-2xl text-slate-600 max-w-2xl font-medium mb-8 leading-relaxed"
          >
            {t.connectingTagline}
          </motion.p>

          {/* Hero CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3.5 w-full sm:w-auto"
          >
            <Link href="/select-role?intent=register" prefetch={false} className="w-full sm:w-auto">
              <Button
                size="lg"
                rightIcon={<ArrowRight className="h-4 w-4" />}
                className="shadow-lg shadow-mint-500/25 bg-mint-500 hover:bg-mint-600 text-white font-bold px-8 py-3.5 w-full sm:w-auto"
              >
                {t.getStarted}
              </Button>
            </Link>
            <Link href="/select-role?intent=login" prefetch={false} className="w-full sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="border-slate-300 text-slate-800 hover:bg-slate-50 font-bold px-8 py-3.5 w-full sm:w-auto"
              >
                {t.signIn}
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ─── CUSTOMER ↔ SHOP VISUAL SECTION ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 relative max-w-6xl mx-auto">
        <div className="bg-white/80 backdrop-blur-md rounded-3xl border border-slate-200/80 p-6 sm:p-10 shadow-xl shadow-slate-200/50">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-6 lg:gap-10 relative">
            {/* LEFT: Customer Card */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="flex-1 w-full max-w-sm lg:max-w-md group"
            >
              <div className="relative rounded-2xl overflow-hidden border border-slate-200/90 bg-slate-50 shadow-md group-hover:shadow-lg transition-all duration-300">
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <Image
                    src="/hero/customer.webp"
                    alt="Customer searching and locating shop on mobile phone"
                    fill
                    priority
                    sizes="(max-width: 768px) 100vw, 480px"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent" />

                  {/* Floating Top Left Badge */}
                  <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-bold text-mint-800 shadow-sm border border-white">
                    <User className="h-3.5 w-3.5 text-mint-600" />
                    <span>{currentLang === "ta" ? "வாடிக்கையாளர்" : "Customer"}</span>
                  </div>

                  {/* Floating Location Tracking Status Badge */}
                  <div className="absolute top-4 right-4 inline-flex items-center gap-1.5 bg-mint-500/90 text-white backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-bold shadow-xs">
                    <MapPin className="h-3 w-3 animate-bounce" />
                    <span>Locating Shop</span>
                  </div>

                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <h3 className="text-lg sm:text-xl font-bold mb-0.5">{t.customerBadge}</h3>
                    <p className="text-xs text-slate-200 font-medium leading-tight">{t.customerSub}</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* CENTER: Irregular Wave / Dashed Animated Connecting Path across Extended Gap */}
            <div className="w-full md:w-56 lg:w-72 xl:w-80 h-28 md:h-36 flex items-center justify-center relative my-4 md:my-0 shrink-0">
              {/* Desktop Horizontal Irregular Wave Path */}
              <div className="hidden md:block w-full h-full relative">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 280 100" fill="none">
                  {/* Background Glow Irregular Wave Path */}
                  <path
                    d="M 10 50 C 45 15, 80 85, 115 35 C 130 15, 140 50, 140 50 C 140 50, 150 85, 165 65 C 200 15, 235 85, 270 50"
                    stroke="#bbf7d4"
                    strokeWidth="6"
                    strokeLinecap="round"
                    fill="none"
                  />
                  {/* Dashed Green Animated Irregular Path */}
                  <path
                    d="M 10 50 C 45 15, 80 85, 115 35 C 130 15, 140 50, 140 50 C 140 50, 150 85, 165 65 C 200 15, 235 85, 270 50"
                    stroke="#16a34d"
                    strokeWidth="4.5"
                    strokeDasharray="8 8"
                    strokeLinecap="round"
                    className="animate-dash-flow"
                    fill="none"
                  />

                  {/* Pulsing Traveling Circle Node directly inside SVG viewBox */}
                  <motion.g
                    animate={{
                      x: DESKTOP_WAVE_X,
                      y: DESKTOP_WAVE_Y,
                    }}
                    transition={{
                      duration: 6,
                      repeat: Infinity,
                      ease: "linear",
                      times: DESKTOP_WAVE_TIMES,
                    }}
                  >
                    {/* Outer Glow Circle */}
                    <circle r="15" fill="#10b981" opacity="0.3" />
                    {/* Main Green Circle */}
                    <circle r="12" fill="#10b981" stroke="#ffffff" strokeWidth="2.5" />
                    {/* Sparkle Star Icon */}
                    <path
                      d="M -3.5 0 L 0 -3.5 L 3.5 0 L 0 3.5 Z M 0 -5 L 0 5 M -5 0 L 5 0"
                      stroke="#ffffff"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </motion.g>
                </svg>

                {/* Dynamic BISHOP Logo Popup holding at Center */}
                <motion.div
                  animate={{
                    opacity: [0, 0, 1, 1, 0, 0, 1, 1, 0, 0],
                    scale: [0.5, 0.5, 1.05, 1.05, 0.5, 0.5, 1.05, 1.05, 0.5, 0.5],
                  }}
                  transition={{
                    duration: 6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: [0, 0.37, 0.40, 0.44, 0.46, 0.91, 0.92, 0.93, 0.94, 1.0],
                  }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 will-change-transform"
                >
                  <div className="flex items-center justify-center bg-white/95 backdrop-blur-md p-2 rounded-full shadow-lg shadow-mint-500/25 border border-mint-300">
                    <Image
                      src="/bishop-icon.svg"
                      alt="BISHOP"
                      width={28}
                      height={28}
                      className="h-7 w-auto object-contain"
                    />
                  </div>
                </motion.div>
              </div>

              {/* Mobile Vertical Irregular Wave Path */}
              <div className="block md:hidden w-full h-full relative">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 100 200" fill="none">
                  <path
                    d="M 50 10 C 20 40, 80 70, 50 100 C 20 130, 80 160, 50 190"
                    stroke="#bbf7d4"
                    strokeWidth="5"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M 50 10 C 20 40, 80 70, 50 100 C 20 130, 80 160, 50 190"
                    stroke="#16a34d"
                    strokeWidth="3.5"
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    className="animate-dash-flow"
                    fill="none"
                  />

                  {/* Mobile Pulsing Traveling Circle Node directly inside SVG viewBox */}
                  <motion.g
                    animate={{
                      x: MOBILE_WAVE_X,
                      y: MOBILE_WAVE_Y,
                    }}
                    transition={{
                      duration: 6,
                      repeat: Infinity,
                      ease: "linear",
                      times: MOBILE_WAVE_TIMES,
                    }}
                  >
                    <circle r="14" fill="#10b981" opacity="0.3" />
                    <circle r="11" fill="#10b981" stroke="#ffffff" strokeWidth="2" />
                    <path
                      d="M -3 0 L 0 -3 L 3 0 L 0 3 Z M 0 -4.5 L 0 4.5 M -4.5 0 L 4.5 0"
                      stroke="#ffffff"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </motion.g>
                </svg>

                {/* Mobile BISHOP Logo Popup holding at Center */}
                <motion.div
                  animate={{
                    opacity: [0, 0, 1, 1, 0, 0, 1, 1, 0, 0],
                    scale: [0.5, 0.5, 1.05, 1.05, 0.5, 0.5, 1.05, 1.05, 0.5, 0.5],
                  }}
                  transition={{
                    duration: 6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: [0, 0.37, 0.40, 0.44, 0.46, 0.91, 0.92, 0.93, 0.94, 1.0],
                  }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 will-change-transform"
                >
                  <div className="flex items-center justify-center bg-white/95 backdrop-blur-md p-1.5 rounded-full shadow-md shadow-mint-500/25 border border-mint-300">
                    <Image
                      src="/bishop-icon.svg"
                      alt="BISHOP"
                      width={22}
                      height={22}
                      className="h-5.5 w-auto object-contain"
                    />
                  </div>
                </motion.div>
              </div>
            </div>

            {/* RIGHT: Shopkeeper Card */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="flex-1 w-full max-w-sm lg:max-w-md group"
            >
              <div className="relative rounded-2xl overflow-hidden border border-slate-200/90 bg-slate-50 shadow-md group-hover:shadow-lg transition-all duration-300">
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <Image
                    src="/hero/shop.webp"
                    alt="Artisanal Bakery & Cafe Shopfront"
                    fill
                    priority
                    sizes="(max-width: 768px) 100vw, 480px"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />

                  {/* Floating Badge */}
                  <div className="absolute top-4 right-4 inline-flex items-center gap-1.5 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-bold text-mint-800 shadow-sm border border-white">
                    <Store className="h-3.5 w-3.5 text-mint-600" />
                    {t.shopBadge}
                  </div>

                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <h3 className="text-xl font-bold mb-0.5">{t.shopBadge}</h3>
                    <p className="text-xs text-slate-200 font-medium">{t.shopSub}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── HORIZONTAL SCROLLING FOOD CAROUSEL ─── */}
      <section className="py-8 my-4 overflow-hidden relative">
        <div className="max-w-7xl mx-auto px-4 mb-4 text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Fresh Delights Available On BISHOP
          </span>
        </div>

        {/* Masked Infinite Horizontal Scroll Container */}
        <div className="relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
          <div className="flex gap-4 sm:gap-6 w-max animate-scroll-horizontal py-2">
            {/* Duplicated Carousel reusing identical webp sources for browser cache efficiency */}
            {carouselItems.concat(carouselItems).map((item, idx) => (
              <div
                key={idx}
                className="flex-none w-44 sm:w-56 bg-white rounded-2xl p-2.5 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-mint-300 transition-all duration-300 group"
              >
                <div className="h-32 sm:h-40 w-full rounded-xl overflow-hidden mb-2 bg-slate-100 relative">
                  <Image
                    src={item.img}
                    alt={item.alt}
                    fill
                    loading="lazy"
                    sizes="(max-width: 640px) 176px, 224px"
                    className="object-cover group-hover:scale-108 transition-transform duration-300"
                  />
                </div>
                <div className="px-1 text-center">
                  <span className="text-xs sm:text-sm font-bold text-slate-800 group-hover:text-mint-700 transition-colors">
                    {item.alt}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SEPARATED FEATURES SECTION (Isolated Re-render Boundary) ─── */}
      <FeaturesSection t={t} />

      {/* ─── Footer ─── */}
      <footer className="py-10 border-t border-slate-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <div className="flex items-center justify-center mb-3">
            <Image
              src="/bishop-logo.svg"
              alt="BISHOP"
              width={120}
              height={32}
              className="h-7 w-auto object-contain"
            />
          </div>
          <p className="text-xs text-slate-500 font-medium tracking-wide">
            © {new Date().getFullYear()} BISHOP. {t.footerDesc}
          </p>
        </div>
      </footer>
    </div>
  );
}
