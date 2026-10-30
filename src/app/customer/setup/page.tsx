"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  User,
  Phone,
  MapPin,
  ArrowRight,
  ArrowLeft,
  Languages,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Navigation,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import { useLanguageStore } from "@/stores/language-store";
import { useCustomerStore } from "@/stores/customer-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";

import { reverseGeocodeCoordinates, logGpsDiagnostics } from "@/lib/location";
import {
  saveCustomerProfileToSupabase,
  fetchCustomerProfileFromSupabase,
} from "@/lib/customer";

export default function CustomerSetupPage() {
  const router = useRouter();
  const { lang, toggleLang } = useLanguageStore();
  const isTa = lang === "ta";
  const landT = DASHBOARD_TRANSLATIONS[lang || "en"].landingPage;

  const { customer, setCustomer } = useCustomerStore();

  const [name, setName] = useState(customer?.name || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [locationAddress, setLocationAddress] = useState(customer?.locationAddress || "");
  const [latitude, setLatitude] = useState<number | null>(customer?.latitude || null);
  const [longitude, setLongitude] = useState<number | null>(customer?.longitude || null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [locationCaptured, setLocationCaptured] = useState<boolean>(
    Boolean(customer?.latitude || customer?.locationAddress)
  );

  // Restore existing customer profile from Supabase on page load if available
  useEffect(() => {
    async function checkExistingProfile() {
      try {
        const existing = await fetchCustomerProfileFromSupabase();
        if (existing && existing.name && (existing.locationAddress || existing.latitude)) {
          setCustomer(existing);
          router.push("/customer");
          return;
        }
      } catch (err) {
        console.warn("[Customer Setup] Error checking existing profile:", err);
      } finally {
        setIsInitializing(false);
      }
    }

    checkExistingProfile();
  }, [setCustomer, router]);

  // Auto-fill from store if available
  useEffect(() => {
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone);
      setLocationAddress(customer.locationAddress);
      setLatitude(customer.latitude);
      setLongitude(customer.longitude);
      setLocationCaptured(Boolean(customer.latitude || customer.locationAddress));
    }
  }, [customer]);

  // Handle Geolocation Detection
  async function detectLocation() {
    if (typeof window === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    setIsDetecting(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);

        // Reverse geocoding using structured helper
        const reverseResult = await reverseGeocodeCoordinates(lat, lng);
        if (reverseResult && reverseResult.cityRegion) {
          setLocationAddress(reverseResult.cityRegion);
        } else {
          setLocationAddress("Current Position");
        }

        // Diagnostic Logging
        logGpsDiagnostics("navigator.geolocation.getCurrentPosition", position, reverseResult);

        setLocationCaptured(true);
        setIsDetecting(false);
        toast.success("Location captured successfully!");
      },
      (error) => {
        setIsDetecting(false);
        console.warn("Geolocation error:", error);
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("Location permission denied. Please enter your location manually.");
        } else {
          toast.error("Unable to retrieve location. Please type your address manually.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }

    if (!locationAddress.trim() && !latitude) {
      toast.error("Please enable location tracking or enter your area address");
      return;
    }

    const updatedProfile = {
      name: name.trim(),
      phone: phone.trim(),
      locationAddress: locationAddress.trim() || "Current Position",
      latitude,
      longitude,
      locationEnabled: Boolean(latitude),
      updatedAt: new Date().toISOString(),
    };

    setCustomer(updatedProfile);
    await saveCustomerProfileToSupabase(updatedProfile);

    toast.success("Customer profile & location saved!");
    router.push("/customer");
  }

  return (
    <div className="auth-shell bg-white min-h-dvh flex items-center justify-center p-4 sm:p-6 relative pt-16 sm:pt-6">
      {/* Back Navigation & Language Switcher */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50">
        <Link
          href="/select-role"
          className="inline-flex items-center justify-center h-10 w-10 sm:h-11 sm:w-11 bg-mint-50 hover:bg-mint-100 rounded-full text-mint-600 hover:text-mint-700 transition-all shadow-sm shadow-black/5 hover:shadow-md hover:shadow-mint-500/20 hover:scale-105 backdrop-blur-sm"
          title="Back to Role Selection"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </div>

      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleLang}
          className="border-mint-200 text-mint-700 hover:bg-mint-50 hover:text-mint-800 text-xs sm:text-sm px-2.5 sm:px-3"
          leftIcon={<Languages className="h-4 w-4" />}
        >
          {isTa ? "English" : "தமிழ்"}
        </Button>
      </div>

      {/* Background Decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-mint-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-mint-300/20 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg relative z-10 my-auto"
      >
        {/* Header & Logo */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="inline-flex items-center justify-center mb-3"
          >
            <Image
              src="/bishop-logo.svg"
              alt="BISHOP"
              width={160}
              height={56}
              className="h-12 sm:h-14 w-auto object-contain drop-shadow-xs"
              priority
            />
          </motion.div>

          <div>
            <div className="soft-pill inline-flex items-center gap-1.5 rounded-full px-4 py-1 text-xs sm:text-sm font-semibold mb-3 mt-1">
              <User className="h-3.5 w-3.5 text-mint-600" />
              <span>{isTa ? "வாடிக்கையாளர் விவரங்கள்" : "Customer Details"}</span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight mb-2">
            {isTa ? "உங்கள் விவரங்களை உள்ளிடவும்" : "Customer Setup & Location"}
          </h1>
          <p className="text-slate-600 text-xs sm:text-sm font-medium max-w-md mx-auto">
            {isTa
              ? "உங்கள் விவரங்கள் மற்றும் இருப்பிடத்தை உள்ளிட்டு தொடரவும்."
              : "Enter your name and enable location tracking to customize your customer experience."}
          </p>
        </div>

        {/* Customer Details Form Card */}
        <Card padding="lg" className="auth-card rounded-3xl bg-white border border-slate-200/90 shadow-xl shadow-slate-200/50">
          <form onSubmit={handleSave} className="space-y-5">
            {/* Customer Name */}
            <Input
              label={isTa ? "உங்கள் பெயர் *" : "Your Name *"}
              type="text"
              placeholder="e.g. John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              leftIcon={<User className="h-4 w-4 text-slate-400" />}
              required
            />

            {/* Phone Number */}
            <Input
              label={isTa ? "தொலைபேசி எண் (விருப்பத்தேர்வு)" : "Phone Number (Optional)"}
              type="tel"
              placeholder="e.g. +91 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              leftIcon={<Phone className="h-4 w-4 text-slate-400" />}
            />

            {/* Location Tracking Section */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-mint-600" />
                  <span>{isTa ? "இருப்பிட கண்காணிப்பு" : "Location Tracking"}</span>
                </label>
                {locationCaptured && (
                  <Badge variant="mint" className="text-[11px] font-bold">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Captured
                  </Badge>
                )}
              </div>

              <p className="text-xs text-slate-500 leading-relaxed font-medium">
                {isTa
                  ? "உங்கள் இருப்பிடத்தை துல்லியமாக கண்டறிய 'எனது இருப்பிடத்தைப் பயன்படுத்து' என்பதைக் கிளிக் செய்யவும்."
                  : "Enable location permission to detect your current position for location-aware ordering."}
              </p>

              {/* Location Detection Button */}
              <Button
                type="button"
                variant="outline"
                onClick={detectLocation}
                isLoading={isDetecting}
                leftIcon={<Navigation className="h-4 w-4 text-mint-600" />}
                className="w-full border-2 border-mint-200 bg-mint-50/60 hover:bg-mint-100/80 text-mint-900 font-bold h-11 text-xs sm:text-sm shadow-xs"
              >
                {isDetecting
                  ? isTa
                    ? "கண்டறியப்படுகிறது..."
                    : "Detecting Current Location..."
                  : locationCaptured
                    ? isTa
                      ? "மீண்டும் இருப்பிடத்தை பெறுக"
                      : "Re-detect Current Location"
                    : isTa
                      ? "எனது இருப்பிடத்தைப் பயன்படுத்து"
                      : "Use My Current Location"}
              </Button>

              {/* Display Captured Location Details */}
              {locationCaptured && (locationAddress || latitude) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="p-3.5 bg-mint-50/90 border border-mint-200 rounded-2xl space-y-1 text-xs text-mint-950 font-medium"
                >
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-mint-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-900 truncate">
                        {locationAddress || "Current Position"}
                      </p>
                      {latitude && longitude && (
                        <p className="text-[11px] text-mint-700 font-semibold mt-0.5">
                          GPS Location Verified
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Manual Location Input Fallback */}
              <div className="pt-2">
                <Input
                  label={isTa ? "முகவரி / பகுதி (கைமுறையாக)" : "Location / Area Address (Manual)"}
                  type="text"
                  placeholder="e.g. RS Puram, Coimbatore"
                  value={locationAddress}
                  onChange={(e) => setLocationAddress(e.target.value)}
                  leftIcon={<MapPin className="h-4 w-4 text-slate-400" />}
                />
              </div>
            </div>

            {/* Submit / Continue Button */}
            <Button
              type="submit"
              size="lg"
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="w-full bg-mint-500 hover:bg-mint-600 text-white font-extrabold shadow-md shadow-mint-500/25 h-12 text-base mt-4"
            >
              {isTa ? "சேமித்து தொடரவும்" : "Save & Continue"}
            </Button>
          </form>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs font-medium text-slate-500 mt-8">
          {landT.footerDesc}
        </p>
      </motion.div>
    </div>
  );
}
