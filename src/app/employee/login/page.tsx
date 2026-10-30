"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { User, Store, Phone, ArrowRight, ArrowLeft, Sparkles, Languages, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import { useLanguageStore } from "@/stores/language-store";
import { useEmployeeStore } from "@/stores/employee-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";

export default function EmployeeLoginPage() {
  const router = useRouter();
  const { lang, toggleLang } = useLanguageStore();
  const isTa = lang === "ta";
  const landT = DASHBOARD_TRANSLATIONS[lang || "en"].landingPage;

  const { setEmployee } = useEmployeeStore();

  const [name, setName] = useState("");
  const [shopName, setShopName] = useState("");
  const [mobile, setMobile] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleEmployeeEntry(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");

    const cleanName = name.trim();
    const cleanShopName = shopName.trim();
    const cleanMobile = mobile.trim();

    if (!cleanName) {
      toast.error(isTa ? "உங்கள் பெயரை உள்ளிடவும்" : "Please enter your Name.");
      return;
    }

    if (!cleanShopName) {
      toast.error(isTa ? "கடை பெயரை உள்ளிடவும்" : "Please enter the Shop Name.");
      return;
    }

    if (!cleanMobile) {
      toast.error(isTa ? "மொபைல் எண்ணை உள்ளிடவும்" : "Please enter your Mobile Number.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/employee/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanName,
          shop_name: cleanShopName,
          phone: cleanMobile,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success || !data.employee) {
        const errorText = data.error || (isTa ? "இந்த கடைக்கு ஊழியர் பதிவு செய்யப்படவில்லை." : "Employee not registered for this shop.");
        setErrorMessage(errorText);
        toast.error(errorText);
        setIsLoading(false);
        return;
      }

      // Valid Employee Session Verified
      setEmployee({
        employee_id: data.employee.employee_id,
        profile_id: data.employee.profile_id,
        full_name: data.employee.full_name,
        phone: data.employee.phone,
        role: data.employee.role,
        shop_id: data.employee.shop_id,
        shop_name: data.employee.shop_name,
        token: data.employee.token || data.token,
      });

      toast.success(isTa ? `வரவேற்கிறோம் ${data.employee.full_name}!` : `Welcome, ${data.employee.full_name}!`);
      router.push("/employee");
    } catch (err: any) {
      console.error("Employee verification error:", err);
      const errTxt = err?.message || (isTa ? "சரிபார்ப்பில் பிழை ஏற்பட்டது" : "Employee verification failed.");
      setErrorMessage(errTxt);
      toast.error(errTxt);
    } finally {
      setIsLoading(false);
    }
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
        className="w-full max-w-md relative z-10 my-auto"
      >
        {/* Header & BISHOP Logo */}
        <div className="text-center mb-6">
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

          <div className="soft-pill inline-flex items-center gap-1.5 rounded-full px-4 py-1 text-xs sm:text-sm font-semibold mb-3">
            <Sparkles className="h-3.5 w-3.5 text-mint-600" />
            <span>{isTa ? "ஊழியர் உள்நுழைவு" : "Employee Portal"}</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight mb-1.5">
            {isTa ? "பணியாளர் அணுகல்" : "Employee Access"}
          </h1>
          <p className="text-slate-600 text-xs sm:text-sm font-medium">
            {isTa
              ? "உங்கள் பணிகள் மற்றும் இருப்பு நிலையை அணுக தேவையான விவரங்களை உள்ளிடவும்."
              : "Enter your registered details to access assigned tasks and stock availability."}
          </p>
        </div>

        {/* Employee Simple Entry Form (ONLY Name, Shop Name, Mobile Number) */}
        <Card padding="lg" className="border-slate-200/90 shadow-xl shadow-slate-200/50">
          <form onSubmit={handleEmployeeEntry} className="space-y-4">
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs font-bold text-red-700 animate-in fade-in duration-200">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* 1. Name */}
            <Input
              label={isTa ? "பணியாளர் பெயர்" : "Your Name"}
              type="text"
              placeholder="e.g. Rajesh Kumar"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrorMessage("");
              }}
              leftIcon={<User className="h-4 w-4 text-slate-400" />}
              required
            />

            {/* 2. Shop Name */}
            <Input
              label={isTa ? "கடை பெயர்" : "Shop Name"}
              type="text"
              placeholder="e.g. Ak mess"
              value={shopName}
              onChange={(e) => {
                setShopName(e.target.value);
                setErrorMessage("");
              }}
              leftIcon={<Store className="h-4 w-4 text-slate-400" />}
              required
            />

            {/* 3. Mobile Number */}
            <Input
              label={isTa ? "மொபைல் எண்" : "Mobile Number"}
              type="tel"
              placeholder="e.g. +91 98765 43210"
              value={mobile}
              onChange={(e) => {
                setMobile(e.target.value);
                setErrorMessage("");
              }}
              leftIcon={<Phone className="h-4 w-4 text-slate-400" />}
              required
            />

            <Button
              type="submit"
              size="lg"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="w-full bg-mint-500 hover:bg-mint-600 text-white font-black shadow-md shadow-mint-500/25 h-12 text-base mt-2"
            >
              {isTa ? "பணியாளர் போர்ட்டலைத் திறக்கவும்" : "Enter Employee Portal"}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs font-medium text-slate-500 mt-8">
          {landT.footerDesc}
        </p>
      </motion.div>
    </div>
  );
}
