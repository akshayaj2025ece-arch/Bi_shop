"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Phone,
  MapPin,
  QrCode,
  Languages,
  Edit3,
  CheckCircle2,
  Sparkles,
  ShoppingBag,
  ExternalLink,
  Store,
  Navigation,
  Compass,
  LocateFixed,
  AlertCircle,
  Radio,
  Search,
  RefreshCw,
  Filter,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useLanguageStore } from "@/stores/language-store";
import { useCustomerStore } from "@/stores/customer-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { createClient } from "@/lib/supabase/client";
import {
  getHaversineDistanceMeters,
  formatDistance,
  getShopLatitude,
  getShopLongitude,
  getDistanceCategory,
  cleanShopDescription,
  type DistanceCategoryInfo,
} from "@/lib/utils";
import type { Shop } from "@/lib/types";
import { toast } from "sonner";

import { reverseGeocodeCoordinates, logGpsDiagnostics } from "@/lib/location";
import { fetchCustomerProfileFromSupabase } from "@/lib/customer";

interface ShopWithDistance extends Shop {
  distanceMeters: number;
  categoryInfo: DistanceCategoryInfo;
}

export default function CustomerDashboardPage() {
  const router = useRouter();
  const { lang, toggleLang } = useLanguageStore();
  const isTa = lang === "ta";

  const { customer, setCustomer } = useCustomerStore();
  const [shopSlugInput, setShopSlugInput] = useState("");
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);

  // Live Location & GPS Tracking State
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(
    customer?.latitude && customer?.longitude
      ? { lat: customer.latitude, lng: customer.longitude }
      : null
  );
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "active" | "denied" | "unavailable" | "error">("idle");
  const [isRecalibrating, setIsRecalibrating] = useState(false);

  // Registered Shops Data State
  const [allShops, setAllShops] = useState<Shop[]>([]);
  const [isLoadingShops, setIsLoadingShops] = useState(true);

  // Category Filter State: "all" (All within 10km), "0-2km", "2-5km", "5-10km"
  const [categoryFilter, setCategoryFilter] = useState<"all" | "0-2km" | "2-5km" | "5-10km">("all");

  const watchIdRef = useRef<number | null>(null);

  // Restore customer profile from Supabase on startup / login before deciding if setup is required
  useEffect(() => {
    async function initCustomerSession() {
      if (customer && customer.name && customer.locationAddress) {
        setIsCheckingProfile(false);
        return;
      }

      const existing = await fetchCustomerProfileFromSupabase();
      if (existing && existing.name && (existing.locationAddress || existing.latitude)) {
        setCustomer(existing);
        setIsCheckingProfile(false);
      } else {
        setIsCheckingProfile(false);
        router.push("/customer/setup");
      }
    }

    initCustomerSession();
  }, [customer, setCustomer, router]);

  // Fetch all active BISHOP shops from Supabase
  const fetchRegisteredShops = useCallback(async () => {
    setIsLoadingShops(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("shops")
        .select("*")
        .eq("is_active", true);

      if (error) {
        console.error("Error fetching shops for customer discovery:", error);
        toast.error("Failed to load registered shops");
        return;
      }

      if (data) {
        const validShops = data.map((s: any) => {
          const lat = getShopLatitude(s);
          const lng = getShopLongitude(s);
          return {
            ...s,
            name: s.name || s.shop_name || "BISHOP Shop",
            phone: s.phone || s.phone_number || "",
            latitude: lat !== null ? lat : undefined,
            longitude: lng !== null ? lng : undefined,
          } as Shop;
        });
        setAllShops(validShops);
      }
    } catch (err) {
      console.error("Supabase shop query exception:", err);
    } finally {
      setIsLoadingShops(false);
    }
  }, []);

  useEffect(() => {
    fetchRegisteredShops();
  }, [fetchRegisteredShops]);

  // Continuous real-time location monitoring via navigator.geolocation.watchPosition()
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGpsStatus("unavailable");
      return;
    }

    setGpsStatus("active");

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        setCurrentCoords({ lat, lng });
        setGpsAccuracy(position.coords.accuracy);
        setGpsStatus("active");

        reverseGeocodeCoordinates(lat, lng).then((reverseResult) => {
          logGpsDiagnostics("navigator.geolocation.watchPosition", position, reverseResult);
        });

        // Sync customer store if position moved noticeably (>0.5m)
        if (
          customer &&
          (!customer.latitude ||
            !customer.longitude ||
            Math.abs(customer.latitude - lat) > 0.000005 ||
            Math.abs(customer.longitude - lng) > 0.000005)
        ) {
          setCustomer({
            ...customer,
            latitude: lat,
            longitude: lng,
            locationEnabled: true,
            updatedAt: new Date().toISOString(),
          });
        }
      },
      (error) => {
        console.warn("Geolocation watch error:", error);
        if (error.code === error.PERMISSION_DENIED) {
          setGpsStatus("denied");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setGpsStatus("unavailable");
        } else {
          setGpsStatus("error");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 3000,
      }
    );

    watchIdRef.current = watchId;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [customer, setCustomer]);

  // Manual location re-detection trigger with clear loading state & error handling
  function handleReDetectLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    setIsRecalibrating(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setCurrentCoords({ lat, lng });
          setGpsAccuracy(position.coords.accuracy);
          setGpsStatus("active");

          const reverseResult = await reverseGeocodeCoordinates(lat, lng);
          logGpsDiagnostics("navigator.geolocation.getCurrentPosition (re-detect)", position, reverseResult);

          if (customer) {
            setCustomer({
              ...customer,
              latitude: lat,
              longitude: lng,
              locationAddress: reverseResult?.cityRegion || customer.locationAddress || "Current Position",
              locationEnabled: true,
              updatedAt: new Date().toISOString(),
            });
          }

          toast.success("Current location updated! 📍");
        } catch (err) {
          console.error("Recalibration error:", err);
          toast.error("Failed to update location.");
        } finally {
          setIsRecalibrating(false);
        }
      },
      (error) => {
        setIsRecalibrating(false);
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("Location permission denied by browser.");
          setGpsStatus("denied");
        } else if (error.code === error.TIMEOUT) {
          toast.error("Location request timed out. Please try again.");
        } else {
          toast.error("Unable to get current location.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // Calculate distances for all registered shops relative to currentCoords
  // Filter out any shop > 10,000 meters (10 km)
  const shopsWithin10km: ShopWithDistance[] = (allShops
    .map((shop) => {
      const shopLat = getShopLatitude(shop);
      const shopLng = getShopLongitude(shop);

      if (!currentCoords || shopLat === null || shopLng === null) {
        return null;
      }

      const dist = getHaversineDistanceMeters(
        currentCoords.lat,
        currentCoords.lng,
        shopLat,
        shopLng
      );

      // Max radius = 10 km (10,000 m)
      const categoryInfo = getDistanceCategory(dist);
      if (!categoryInfo) return null; // Excluded > 10 km

      const item: ShopWithDistance = {
        ...shop,
        latitude: shopLat,
        longitude: shopLng,
        distanceMeters: dist,
        categoryInfo,
      };
      return item;
    })
    .filter((s) => s !== null) as ShopWithDistance[])
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  // Apply distance category filter
  const displayedShops = shopsWithin10km.filter((shop) => {
    if (categoryFilter === "0-2km") return shop.distanceMeters <= 2000;
    if (categoryFilter === "2-5km") return shop.distanceMeters > 2000 && shop.distanceMeters <= 5000;
    if (categoryFilter === "5-10km") return shop.distanceMeters > 5000 && shop.distanceMeters <= 10000;
    return true; // "all"
  });

  // Count per category
  const countClosest = shopsWithin10km.filter((s) => s.distanceMeters <= 2000).length;
  const countNearby = shopsWithin10km.filter((s) => s.distanceMeters > 2000 && s.distanceMeters <= 5000).length;
  const countWithinRange = shopsWithin10km.filter((s) => s.distanceMeters > 5000 && s.distanceMeters <= 10000).length;

  if (isCheckingProfile || !customer) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white text-slate-500 font-semibold">
        Restoring customer profile...
      </div>
    );
  }

  function handleOpenShop(e: React.FormEvent) {
    e.preventDefault();
    if (!shopSlugInput.trim()) {
      toast.error("Please enter a shop name or code");
      return;
    }
    const cleanSlug = shopSlugInput.trim().toLowerCase().replace(/\s+/g, "-");
    router.push(`/menu/${cleanSlug}`);
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-mint-50/60 via-white to-mint-50/40 text-slate-900 overflow-x-hidden pb-16">
      {/* ── Navbar ── */}
      <nav className="glass border-b border-slate-200/50 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Image
              src="/bishop-icon.svg"
              alt="BISHOP"
              width={36}
              height={36}
              className="h-9 w-auto object-contain group-hover:scale-105 transition-transform"
              priority
            />
          </Link>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLang}
              className="border-mint-200 text-mint-700 hover:bg-mint-50 text-xs font-semibold"
              leftIcon={<Languages className="h-4 w-4" />}
            >
              {isTa ? "English" : "தமிழ்"}
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Header Greeting Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm"
        >
          <div>
            <div className="inline-flex items-center gap-1.5 bg-mint-100 text-mint-800 px-3 py-1 rounded-full text-xs font-extrabold mb-2">
              <User className="h-3.5 w-3.5 text-mint-600" />
              <span>{isTa ? "வாடிக்கையாளர் சுயவிவரம்" : "Customer Profile"}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight">
              {isTa ? `வணக்கம், ${customer.name}!` : `Welcome, ${customer.name}!`}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              {isTa
                ? "உங்கள் இருப்பிடம் வெற்றிகரமாக பதிவு செய்யப்பட்டுள்ளது."
                : "Real-time location active — discovering shops within 10 km."}
            </p>
          </div>

          <Link href="/customer/setup">
            <Button variant="outline" size="sm" className="border-mint-200 text-mint-800 hover:bg-mint-50 font-bold shrink-0">
              <Edit3 className="h-4 w-4 mr-1.5 text-mint-600" />
              {isTa ? "இருப்பிடத்தை மாற்று" : "Edit Profile / Location"}
            </Button>
          </Link>
        </motion.div>

        {/* Live GPS & Location Status Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card padding="md" className="bg-gradient-to-br from-mint-50/90 via-white to-emerald-50/40 border border-mint-200/90 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 rounded-2xl bg-mint-500 text-white flex items-center justify-center shadow-md shadow-mint-500/25 shrink-0">
                  <Navigation className="h-5 w-5 animate-pulse" />
                  {gpsStatus === "active" && (
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white"></span>
                    </span>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-extrabold text-slate-900">
                      {isTa ? "நேரலை GPS கண்காணிப்பு" : "Live Location Tracking"}
                    </h2>
                    {gpsStatus === "active" && (
                      <Badge variant="mint" className="text-[10px] font-extrabold uppercase tracking-wide">
                        <Radio className="h-3 w-3 mr-1 animate-pulse text-mint-600" />
                        Live GPS
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    {customer.locationAddress || "Continuous position monitoring"}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReDetectLocation}
                isLoading={isRecalibrating}
                disabled={isRecalibrating}
                leftIcon={!isRecalibrating ? <LocateFixed className="h-3.5 w-3.5 text-mint-600" /> : undefined}
                className="border-mint-300 text-mint-900 hover:bg-mint-100/80 text-xs font-bold shrink-0 shadow-2xs"
              >
                {isRecalibrating
                  ? isTa
                    ? "கண்டறியப்படுகிறது..."
                    : "Locating..."
                  : isTa
                    ? "இருப்பிடத்தை புதுப்பி"
                    : "Recalibrate GPS"}
              </Button>
            </div>

            {/* Current Coordinates Bar */}
            <div className="bg-white/90 p-3.5 rounded-2xl border border-slate-200/80 space-y-1.5 text-xs text-slate-800 font-semibold">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-slate-700">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-mint-600 shrink-0" />
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {customer.locationAddress || "Current Position"}
                  </span>
                </div>

                {currentCoords && (
                  <span className="text-[11px] font-bold text-mint-800 bg-mint-50 px-2.5 py-1 rounded-lg border border-mint-200 shrink-0 inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-mint-600" />
                    <span>Location Active{gpsAccuracy ? ` (±${Math.round(gpsAccuracy)}m)` : ""}</span>
                  </span>
                )}
              </div>

              {gpsStatus === "denied" && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Location permission denied by browser. Please enable browser location permissions or click Recalibrate GPS.</span>
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* ── LOCATION-BASED NEARBY SHOPS DISCOVERY SECTION (MAX 10 KM) ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="space-y-4"
        >
          {/* Section Header */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-mint-100 text-mint-700 flex items-center justify-center">
                    <Compass className="h-5 w-5 text-mint-600" />
                  </div>
                  <h2 className="text-lg sm:text-xl font-extrabold text-slate-950 tracking-tight">
                    {isTa ? "அருகிலுள்ள BISHOP கடைகள் (10km)" : "Nearby BISHOP Shops"}
                  </h2>
                  <Badge variant="mint" className="text-xs font-extrabold">
                    Max 10 km Radius
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  Showing registered BISHOP shops sorted from nearest to farthest within 10 km.
                </p>
              </div>

              {/* Total Shops Badge */}
              <div className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-800 px-3 py-1.5 rounded-xl text-xs font-extrabold border border-slate-200 shrink-0">
                <Store className="h-4 w-4 text-mint-600" />
                <span>{shopsWithin10km.length} Shops Within Range</span>
              </div>
            </div>

            {/* Distance Category Legend & Filters */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-mint-600" />
                <span>Distance Range Categories</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* All Filter */}
                <button
                  type="button"
                  onClick={() => setCategoryFilter("all")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition-all ${
                    categoryFilter === "all"
                      ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  All (0–10 km) ({shopsWithin10km.length})
                </button>

                {/* 0-2 km -> BLUE -> Closest */}
                <button
                  type="button"
                  onClick={() => setCategoryFilter("0-2km")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold border transition-all ${
                    categoryFilter === "0-2km"
                      ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                      : "bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                  <span>0–2 km: Closest</span>
                  <span className="ml-1 opacity-80">({countClosest})</span>
                </button>

                {/* 2-5 km -> ORANGE -> Nearby */}
                <button
                  type="button"
                  onClick={() => setCategoryFilter("2-5km")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold border transition-all ${
                    categoryFilter === "2-5km"
                      ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                      : "bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                  <span>2–5 km: Nearby</span>
                  <span className="ml-1 opacity-80">({countNearby})</span>
                </button>

                {/* 5-10 km -> GREEN -> Within Range */}
                <button
                  type="button"
                  onClick={() => setCategoryFilter("5-10km")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold border transition-all ${
                    categoryFilter === "5-10km"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                      : "bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>5–10 km: Within Range</span>
                  <span className="ml-1 opacity-80">({countWithinRange})</span>
                </button>
              </div>
            </div>
          </div>

          {/* Loading State */}
          {isLoadingShops && (
            <Card padding="lg" className="text-center py-10 space-y-3">
              <RefreshCw className="h-8 w-8 text-mint-500 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-slate-600">
                Finding registered BISHOP shops within 10 km...
              </p>
            </Card>
          )}

          {/* Shops Grid */}
          {!isLoadingShops && displayedShops.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatePresence>
                {displayedShops.map((shop) => {
                  const cat = shop.categoryInfo;
                  return (
                    <motion.div
                      key={shop.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Card
                        padding="lg"
                        className="bg-white border border-slate-200/90 hover:border-mint-300 transition-all shadow-sm hover:shadow-md rounded-3xl flex flex-col justify-between h-full space-y-4"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 text-white flex items-center justify-center text-xl font-bold shadow-md shadow-mint-500/20 shrink-0">
                                {shop.name?.charAt(0)?.toUpperCase() || "S"}
                              </div>
                              <div>
                                <h3 className="text-base font-extrabold text-slate-950 leading-tight">
                                  {shop.name}
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">
                                  {shop.location || shop.address || "BISHOP Verified Merchant"}
                                </p>
                              </div>
                            </div>

                            {/* Distance Badge & Category Indicator */}
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <div className="inline-flex items-center gap-1 bg-slate-900 text-white px-2.5 py-1 rounded-xl text-xs font-black shadow-2xs font-mono">
                                <MapPin className="h-3.5 w-3.5 text-mint-400" />
                                <span>{formatDistance(shop.distanceMeters)}</span>
                              </div>

                              {/* Distance Category Badge (Blue / Orange / Green) */}
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${cat.badgeClass}`}
                              >
                                <span className={`h-2 w-2 rounded-full ${cat.dotClass}`} />
                                {cat.label}
                              </span>
                            </div>
                          </div>

                          {cleanShopDescription(shop.description) && (
                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed pt-1">
                              {cleanShopDescription(shop.description)}
                            </p>
                          )}
                        </div>

                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                            <Navigation className="h-3 w-3 text-mint-600" />
                            {formatDistance(shop.distanceMeters)} from your position
                          </span>
                          <Link href={`/menu/${shop.slug || shop.id}`} className="shrink-0">
                            <Button
                              size="sm"
                              className="bg-mint-500 hover:bg-mint-600 text-white font-extrabold text-xs shadow-xs"
                              rightIcon={<ExternalLink className="h-3.5 w-3.5" />}
                            >
                              {isTa ? "மெனுவை திறக்குக" : "Open Menu"}
                            </Button>
                          </Link>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          {/* Empty State when no shops found within 10 km */}
          {!isLoadingShops && displayedShops.length === 0 && (
            <Card padding="lg" className="bg-white border border-slate-200/90 rounded-3xl text-center py-10 space-y-4 shadow-sm">
              <div className="h-16 w-16 rounded-3xl bg-mint-50 border border-mint-200 flex items-center justify-center mx-auto text-mint-600">
                <Store className="h-8 w-8" />
              </div>

              <div className="max-w-md mx-auto space-y-2">
                <h3 className="text-lg font-extrabold text-slate-900">
                  {isTa ? "10 கி.மீ சுற்றளவில் கடைகள் இல்லை" : "No BISHOP Shops Within 10 km"}
                </h3>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  {categoryFilter === "all"
                    ? "There are currently no registered BISHOP shops within 10 km of your exact GPS location."
                    : `No registered BISHOP shops matching the '${categoryFilter}' range filter.`}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                {categoryFilter !== "all" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCategoryFilter("all")}
                    leftIcon={<Search className="h-4 w-4 text-mint-600" />}
                    className="border-mint-300 text-mint-900 hover:bg-mint-50 font-bold text-xs"
                  >
                    View All Shops Within 10 km ({shopsWithin10km.length})
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleReDetectLocation}
                  isLoading={isRecalibrating}
                  disabled={isRecalibrating}
                  leftIcon={!isRecalibrating ? <RefreshCw className="h-4 w-4 text-slate-500" /> : undefined}
                  className="text-xs font-semibold"
                >
                  {isRecalibrating
                    ? isTa
                      ? "கண்டறியப்படுகிறது..."
                      : "Locating..."
                    : "Re-detect GPS Location"}
                </Button>
              </div>
            </Card>
          )}
        </motion.div>

        {/* Direct Shop Search / QR Code Access */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card padding="lg" className="border border-slate-200/90 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <QrCode className="h-5 w-5 text-mint-600" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-950">
                  {isTa ? "கடை மெனுவை நேரடியாக திறக்கவும்" : "Direct Shop Search / QR Code"}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {isTa
                    ? "உங்கள் மேஜையில் உள்ள QR குறியீட்டை ஸ்கேன் செய்யவும் அல்லது கடை பெயரை உள்ளிடவும்."
                    : "Scan a shop's QR code at your table or type a shop name/code to open their menu directly."}
                </p>
              </div>
            </div>

            <form onSubmit={handleOpenShop} className="flex flex-col sm:flex-row gap-3 pt-2">
              <Input
                placeholder={isTa ? "கடை பெயர் / குறியீட்டை உள்ளிடவும்..." : "Enter shop name or code (e.g. ak-mess)..."}
                value={shopSlugInput}
                onChange={(e) => setShopSlugInput(e.target.value)}
                leftIcon={<Store className="h-4 w-4 text-slate-400" />}
                className="flex-1"
              />
              <Button
                type="submit"
                rightIcon={<ExternalLink className="h-4 w-4" />}
                className="bg-mint-500 hover:bg-mint-600 text-white font-extrabold shrink-0"
              >
                {isTa ? "மெனுவை திறக்குக" : "Open Menu"}
              </Button>
            </form>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
