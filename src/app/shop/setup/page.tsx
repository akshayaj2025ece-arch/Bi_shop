"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import {
  Store,
  MapPin,
  Phone,
  Mail,
  FileText,
  ArrowRight,
  Sparkles,
  Languages,
  Navigation,
  Compass,
  LocateFixed,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import type { Shop, Profile } from "@/lib/types";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";

import { reverseGeocodeCoordinates, logGpsDiagnostics } from "@/lib/location";

export default function ShopSetupPage() {
  const router = useRouter();
  const { user, shop, setShop, setUser } = useAuthStore();
  const { lang, toggleLang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"].shopSetupPage;
  const settT = DASHBOARD_TRANSLATIONS[lang || "en"].settingsPage;

  const [isLoading, setIsLoading] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    address: "",
    location: "",
    phone_number: "",
    email: user?.email || "",
    gst_number: "",
    tax_rate: "0",
    owner_age: "",
  });

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }: any) => {
      if (data?.user?.email) {
        setForm((prev) => ({
          ...prev,
          email: prev.email || data.user.email || "",
        }));
      }
    });
  }, []);

  function updateForm(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50);
  }

  function handleDetectLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser. Please enter your shop location manually.");
      return;
    }

    setIsDetectingLocation(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);

        // Structured Reverse Geocoding using OpenStreetMap Nominatim API
        try {
          const locationData = await reverseGeocodeCoordinates(lat, lng);
          logGpsDiagnostics("ShopSetupPage.getCurrentPosition", position, locationData);

          if (locationData) {
            if (!form.location) {
              updateForm("location", locationData.cityRegion);
            }
            if (!form.address) {
              updateForm("address", locationData.streetAddress);
            }
          }
        } catch (err) {
          console.warn("Reverse geocoding error:", err);
        } finally {
          setIsDetectingLocation(false);
          toast.success("Shop GPS location captured successfully! 📍");
        }
      },
      (error) => {
        setIsDetectingLocation(false);
        console.warn("Geolocation error:", error);
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("Location permission denied. You can manually type your shop address.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          toast.error("Location unavailable. Please enter your shop address manually.");
        } else if (error.code === error.TIMEOUT) {
          toast.error("Location request timed out. Please try again or type manually.");
        } else {
          toast.error("Unable to retrieve location. Please type your shop address manually.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.name.trim()) {
      toast.error("Shop name is required");
      return;
    }

    if (!form.location.trim()) {
      toast.error("Location is required");
      return;
    }

    if (!form.phone_number.trim()) {
      toast.error("Phone number is required");
      return;
    }

    const ageValue = parseInt(form.owner_age);
    if (!form.owner_age || isNaN(ageValue) || ageValue < 18) {
      toast.error("Valid owner age (18+) is required");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      const {
        data: { user: authUser },
        error: authUserError,
      } = await supabase.auth.getUser();

      if (authUserError || !authUser) {
        toast.error("You must be logged in. Please sign in again.");
        return;
      }

      const { data: existingProfile, error: profileCheckError } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, shop_id")
        .eq("id", authUser.id)
        .maybeSingle();

      if (profileCheckError && profileCheckError.code !== "PGRST116") {
        console.error("Profile lookup error:", profileCheckError);
        toast.error("We could not load your profile. Please try again.");
        return;
      }

      let profileToUse: Profile | null | undefined = existingProfile as Profile | null | undefined;

      if (!profileToUse) {
        const { error: profileInsertError } = await supabase.from("profiles").insert({
          id: authUser.id,
          email: authUser.email ?? (form.email.trim() || ""),
          full_name: authUser.user_metadata?.full_name || user?.full_name || "User",
          role: "shopkeeper",
        });

        if (profileInsertError) {
          console.error("Profile creation error:", profileInsertError);
          toast.error(profileInsertError.message);
          return;
        }

        const nowIso = new Date().toISOString();
        profileToUse = {
          id: authUser.id,
          email: authUser.email ?? (form.email.trim() || ""),
          full_name: authUser.user_metadata?.full_name || user?.full_name || "User",
          role: "shopkeeper",
          shop_id: undefined,
          created_at: nowIso,
          updated_at: nowIso,
        } as Profile;
      }

      const { data: existingShops, error: searchError } = await supabase
        .from("shops")
        .select("*")
        .eq("owner_id", authUser.id)
        .ilike("name", form.name.trim())
        .limit(1);

      if (!searchError && existingShops && existingShops.length > 0) {
        const dbShop = existingShops[0];
        const { error: linkProfileErr } = await supabase
          .from("profiles")
          .update({
            role: "shopkeeper",
            shop_id: dbShop.id,
            phone: form.phone_number.trim() || null,
          })
          .eq("id", authUser.id);

        if (linkProfileErr) {
          console.error("Linking profile error:", linkProfileErr);
        }

        // Fetch verified owned shops directly from the database for this authenticated account
        const { data: userOwnedShops } = await supabase
          .from("shops")
          .select("*")
          .eq("owner_id", authUser.id)
          .order("created_at", { ascending: true });

        const verifiedShops = (userOwnedShops as Shop[]) && (userOwnedShops as Shop[]).length > 0
          ? (userOwnedShops as Shop[])
          : [dbShop as Shop];

        useAuthStore.getState().setShops(verifiedShops);
        useAuthStore.getState().setIsAllShops(false);
        if (dbShop && dbShop.owner_id === authUser.id) {
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem("bishop_active_shop_id", dbShop.id);
            } catch {
              // ignore
            }
          }
        }

        setShop(dbShop as Shop);
        setUser({ ...profileToUse, shop_id: dbShop.id, phone: form.phone_number.trim() } as Profile);

        toast.success("Shop linked successfully! 🎉");
        router.push("/dashboard");
        router.refresh();
        return;
      }

      let slug = generateSlug(form.name.trim());
      if (!slug) slug = `shop-${Date.now().toString(36)}`;

      const { data: slugCheck } = await supabase
        .from("shops")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (slugCheck) {
        slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      let finalDescription = form.description.trim() || "";
      if (latitude !== null && longitude !== null) {
        finalDescription = finalDescription
          .replace(/__LAT__:[^\s_]+/g, "")
          .replace(/__LNG__:[^\s_]+/g, "")
          .trim();
        finalDescription += ` __LAT__:${latitude} __LNG__:${longitude}`;
      }

      const ownerName =
        authUser.user_metadata?.full_name ||
        profileToUse?.full_name ||
        user?.full_name ||
        "Shopkeeper";

      const ownerAge = parseInt(form.owner_age) || 18;
      const phoneVal = form.phone_number.trim() || null;
      const shopNameVal = form.name.trim();

      const shopPayload: any = {
        name: shopNameVal,
        shop_name: shopNameVal,
        owner_name: ownerName,
        owner_age: ownerAge,
        slug,
        description: finalDescription || null,
        address: form.address.trim() || null,
        location: form.location.trim() || null,
        latitude: latitude !== null ? latitude : null,
        longitude: longitude !== null ? longitude : null,
        phone: phoneVal,
        phone_number: phoneVal,
        email: form.email.trim() || null,
        gst_number: form.gst_number.trim() || null,
        tax_rate: parseFloat(form.tax_rate) || 0,
        owner_id: authUser.id,
        is_active: true,
      };

      let newShop: any = null;
      let shopError: any = null;

      const directRes = await supabase
        .from("shops")
        .insert(shopPayload)
        .select("*")
        .single();

      newShop = directRes.data;
      shopError = directRes.error;

      if (shopError && (shopError.code === "PGRST204" || shopError.code === "42703" || shopError.message?.includes("column"))) {
        delete shopPayload.latitude;
        delete shopPayload.longitude;

        const fallbackRes = await supabase
          .from("shops")
          .insert(shopPayload)
          .select("*")
          .single();

        newShop = fallbackRes.data;
        shopError = fallbackRes.error;
      }

      if (shopError || !newShop) {
        console.error("Shop insertion error:", {
          message: shopError?.message,
          code: shopError?.code,
          details: shopError?.details,
          hint: shopError?.hint,
        });
        toast.error(shopError?.message || "Failed to create shop.");
        return;
      }

      const shopId = newShop.id;

      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({
          role: "shopkeeper",
          shop_id: shopId,
          phone: form.phone_number.trim() || null,
        })
        .eq("id", authUser.id);

      if (updateProfileError) {
        console.warn("Error updating profile's shop_id:", updateProfileError);
      }

      const { error: empInsertError } = await supabase.from("employees").insert({
        shop_id: shopId,
        profile_id: authUser.id,
        role: "shopkeeper",
        is_active: true,
      });

      if (empInsertError) {
        console.warn("Shopkeeper employee row creation skipped/errored:", empInsertError);
      }

      const shopDataToSet: Shop = {
        ...newShop,
        owner_id: authUser.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Fetch fresh, verified owned shops directly for this authenticated account
      const { data: userOwnedShops } = await supabase
        .from("shops")
        .select("*")
        .eq("owner_id", authUser.id)
        .order("created_at", { ascending: true });

      const verifiedShops = (userOwnedShops as Shop[]) && (userOwnedShops as Shop[]).length > 0
        ? (userOwnedShops as Shop[])
        : [shopDataToSet];

      useAuthStore.getState().setShops(verifiedShops);
      useAuthStore.getState().setIsAllShops(false);
      if (newShop && newShop.owner_id === authUser.id) {
        if (typeof window !== "undefined") {
          try {
            const userStorageKey = `bishop_active_shop_id_${authUser.id}`;
            localStorage.setItem(userStorageKey, shopId);
            localStorage.setItem("bishop_active_shop_id", shopId);
          } catch {
            // ignore
          }
        }
      }

      setShop(shopDataToSet);
      setUser({ ...profileToUse, role: "shopkeeper", shop_id: shopId, phone: form.phone_number.trim() } as Profile);

      toast.success("Shop created successfully! 🎉");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-shell min-h-dvh flex items-center justify-center p-4 sm:p-6 relative">
      {/* Top Language Switcher */}
      <div className="absolute top-6 right-6 z-50">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={toggleLang}
          className="border-mint-200 text-mint-700 hover:bg-mint-50 hover:text-mint-800"
          leftIcon={<Languages className="h-4 w-4" />}
        >
          {lang === "en" ? "தமிழ்" : "English"}
        </Button>
      </div>

      {/* Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-mint-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-mint-300/20 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg relative z-10"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="inline-flex items-center justify-center mb-4"
          >
            <Image
              src="/bishop-logo.svg"
              alt="BISHOP"
              width={160}
              height={56}
              className="h-14 sm:h-16 w-auto object-contain drop-shadow-xs"
              priority
            />
          </motion.div>
          <br />
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="inline-flex items-center gap-2 bg-mint-100/80 text-mint-700 px-4 py-1.5 rounded-full text-sm font-medium mb-4 border border-mint-200/50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t.title}
          </motion.div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
            {t.title}
          </h1>
          <p className="text-slate-500 text-sm">
            {t.subtitle}
          </p>
        </div>

        {/* Form Card */}
        <Card padding="lg" className="auth-card rounded-2xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-3">
                <Input
                  label={t.shopNameLabel}
                  placeholder="My Bakery"
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                  leftIcon={<Store className="h-4 w-4" />}
                  required
                />
              </div>
              <div className="sm:col-span-1">
                <Input
                  label={t.ageLabel}
                  type="number"
                  placeholder="18"
                  value={form.owner_age}
                  onChange={(e) => updateForm("owner_age", e.target.value)}
                  required
                  min="18"
                  max="120"
                />
              </div>
            </div>

            <Textarea
              label={t.descriptionLabel}
              placeholder="..."
              value={form.description}
              onChange={(e) => updateForm("description", e.target.value)}
            />

            {/* ── SHOP LOCATION & GPS TRACKING SECTION ── */}
            <div className="border border-mint-200/80 bg-mint-50/40 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-mint-800 font-extrabold text-sm sm:text-base">
                    <Navigation className="h-4 w-4 text-mint-600 shrink-0" />
                    <span>Shop Location & GPS Tracking</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Capture your shop's physical GPS location for nearby customer discovery.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDetectLocation}
                  isLoading={isDetectingLocation}
                  leftIcon={<LocateFixed className="h-4 w-4 text-mint-600" />}
                  className="border-mint-300 text-mint-800 hover:bg-mint-100/80 font-bold shrink-0 shadow-xs"
                >
                  {isDetectingLocation ? "Detecting GPS..." : "Use My Current Location"}
                </Button>
              </div>

              {/* Status Badge & Map Preview */}
              {latitude !== null && longitude !== null && (
                <div className="flex flex-col gap-3 pt-1">
                  <div className="inline-flex items-center gap-2 bg-mint-100/90 text-mint-900 px-3 py-1.5 rounded-xl text-xs font-bold border border-mint-300/60 shadow-2xs">
                    <CheckCircle2 className="h-4 w-4 text-mint-600 shrink-0" />
                    <span>
                      {form.address || form.location
                        ? `Shop Location Saved: ${form.address || form.location}`
                        : "Shop Location Saved"}
                    </span>
                  </div>

                  {/* OpenStreetMap Map Pin Preview */}
                  <div className="relative w-full h-36 rounded-xl overflow-hidden border border-mint-200/90 shadow-inner bg-slate-100">
                    <iframe
                      title="Shop Location Preview Map"
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      scrolling="no"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${longitude - 0.005}%2C${latitude - 0.005}%2C${longitude + 0.005}%2C${latitude + 0.005}&layer=mapnik&marker=${latitude}%2C${longitude}`}
                      className="w-full h-full filter contrast-[1.03] saturate-[1.1]"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t.locationLabel}
                placeholder="City / Region"
                value={form.location}
                onChange={(e) => updateForm("location", e.target.value)}
                leftIcon={<MapPin className="h-4 w-4" />}
                required
              />
              <Input
                label={settT.address}
                placeholder="123 Main Street"
                value={form.address}
                onChange={(e) => updateForm("address", e.target.value)}
                leftIcon={<MapPin className="h-4 w-4" />}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t.phoneLabel}
                type="tel"
                placeholder="+91 98765 43210"
                value={form.phone_number}
                onChange={(e) => updateForm("phone_number", e.target.value)}
                leftIcon={<Phone className="h-4 w-4" />}
                required
              />
              <div>
                <Input
                  label={`${settT.email} (Public Contact)`}
                  type="email"
                  placeholder="shop@example.com"
                  value={form.email}
                  onChange={(e) => updateForm("email", e.target.value)}
                  leftIcon={<Mail className="h-4 w-4" />}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Public contact email. Shop ownership is bound to your signed-in account ({user?.email || "Signed-in account"}).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t.gstLabel}
                placeholder="22AAAAA0000A1Z5"
                value={form.gst_number}
                onChange={(e) => updateForm("gst_number", e.target.value)}
                leftIcon={<FileText className="h-4 w-4" />}
              />
              <Input
                label={t.taxRateLabel}
                type="number"
                placeholder="5"
                value={form.tax_rate}
                onChange={(e) => updateForm("tax_rate", e.target.value)}
                min="0"
                max="100"
                step="0.1"
              />
            </div>

            <Button
              type="submit"
              size="lg"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="w-full mt-2"
            >
              {t.submitBtn}
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
