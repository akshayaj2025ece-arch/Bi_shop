"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  Store,
  User,
  ArrowRight,
  ArrowLeft,
  Languages,
  CheckCircle2,
  UtensilsCrossed,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";

function RoleSelectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = searchParams.get("intent") || searchParams.get("mode") || "register";

  const { lang, toggleLang } = useLanguageStore();
  const isTa = lang === "ta";
  const landT = DASHBOARD_TRANSLATIONS[lang || "en"].landingPage;

  const [selectedRole, setSelectedRole] = useState<"shopkeeper" | "customer" | "employee" | null>(null);

  function handleContinue() {
    if (!selectedRole) return;

    if (selectedRole === "shopkeeper") {
      if (intent === "login") {
        router.push("/login");
      } else {
        router.push("/register");
      }
    } else if (selectedRole === "employee") {
      router.push("/employee/login");
    } else {
      // Customer / People flow -> redirect to customer details & location setup
      router.push("/customer/setup");
    }
  }

  return (
    <div className="auth-shell bg-white min-h-dvh flex items-center justify-center p-4 sm:p-6 relative pt-16 sm:pt-6">
      {/* Back Navigation & Language Switcher */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50">
        <Link
          href="/"
          className="inline-flex items-center justify-center h-10 w-10 sm:h-11 sm:w-11 bg-mint-50 hover:bg-mint-100 rounded-full text-mint-600 hover:text-mint-700 transition-all shadow-sm shadow-black/5 hover:shadow-md hover:shadow-mint-500/20 hover:scale-105 backdrop-blur-sm"
          title="Back to Landing Page"
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
        className="w-full max-w-4xl relative z-10 my-auto"
      >
        {/* Header & BISHOP Logo */}
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
              <Sparkles className="h-3.5 w-3.5 text-mint-600" />
              <span>{isTa ? "பாத்திர தேர்வு" : "Role Selection"}</span>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black text-slate-950 tracking-tight mb-2">
            {isTa ? "நீங்கள் யார்?" : "Who are you?"}
          </h1>
          <p className="text-slate-600 text-sm sm:text-base font-medium max-w-md mx-auto">
            {isTa
              ? "BISHOP உடன் தொடங்குவதற்கு உங்கள் பாத்திரத்தைத் தேர்ந்தெடுக்கவும்"
              : "Select your role to continue to the appropriate BISHOP experience."}
          </p>
        </div>

        {/* Role Cards Grid (Exact 3 Roles: Shopkeeper, Customer, Employee) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8">
          {/* ── CARD 1: SHOPKEEPER ── */}
          <motion.div
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setSelectedRole("shopkeeper")}
            className={`relative rounded-3xl p-6 sm:p-7 cursor-pointer transition-all duration-300 ${
              selectedRole === "shopkeeper"
                ? "border-2 border-mint-500 bg-gradient-to-b from-mint-50/90 via-white to-mint-50/40 shadow-xl shadow-mint-500/15 ring-4 ring-mint-500/10 scale-[1.02]"
                : "border border-slate-200/90 bg-white/90 shadow-sm hover:border-mint-300 hover:shadow-md"
            }`}
          >
            {/* Selection Checkmark Badge */}
            {selectedRole === "shopkeeper" && (
              <div className="absolute top-4 right-4 inline-flex items-center gap-1 bg-mint-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm animate-in fade-in zoom-in duration-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{isTa ? "தேர்வுசெய்யப்பட்டது" : "Selected"}</span>
              </div>
            )}

            <div
              className={`h-14 w-14 rounded-2xl flex items-center justify-center mb-5 transition-colors ${
                selectedRole === "shopkeeper"
                  ? "bg-mint-500 text-white shadow-lg shadow-mint-500/30 scale-105"
                  : "bg-mint-50 text-mint-700 border border-mint-100"
              }`}
            >
              <Store className="h-7 w-7" />
            </div>

            <div className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider text-mint-700 bg-mint-100/80 mb-2">
              {isTa ? "கடை உரிமையாளர்" : "Bakery / Hotel Owner"}
            </div>

            <h3 className="text-xl sm:text-2xl font-black text-slate-950 mb-2">
              {isTa ? "கடைக்காரர்" : "Shopkeeper"}
            </h3>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium mb-4">
              {isTa
                ? "உங்கள் பேக்கரி அல்லது ஹோட்டலை நிர்வகிக்கவும். ஆர்டர்கள், பொருட்கள் மற்றும் பகுப்பாய்வு."
                : "I own or manage a bakery, hotel, or shop. Manage POS, items, staff, and live analytics."}
            </p>

            <ul className="space-y-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-700">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "POS & நேரடி ஆர்டர்கள்" : "POS & Realtime Orders"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "பொருட்கள் & சரக்கு மேலாண்மை" : "Item & Inventory Management"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "விற்பனை பகுப்பாய்வு" : "Sales & Revenue Analytics"}</span>
              </li>
            </ul>
          </motion.div>

          {/* ── CARD 2: CUSTOMER / PEOPLE ── */}
          <motion.div
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setSelectedRole("customer")}
            className={`relative rounded-3xl p-6 sm:p-7 cursor-pointer transition-all duration-300 ${
              selectedRole === "customer"
                ? "border-2 border-mint-500 bg-gradient-to-b from-mint-50/90 via-white to-mint-50/40 shadow-xl shadow-mint-500/15 ring-4 ring-mint-500/10 scale-[1.02]"
                : "border border-slate-200/90 bg-white/90 shadow-sm hover:border-mint-300 hover:shadow-md"
            }`}
          >
            {/* Selection Checkmark Badge */}
            {selectedRole === "customer" && (
              <div className="absolute top-4 right-4 inline-flex items-center gap-1 bg-mint-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm animate-in fade-in zoom-in duration-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{isTa ? "தேர்வுசெய்யப்பட்டது" : "Selected"}</span>
              </div>
            )}

            <div
              className={`h-14 w-14 rounded-2xl flex items-center justify-center mb-5 transition-colors ${
                selectedRole === "customer"
                  ? "bg-mint-500 text-white shadow-lg shadow-mint-500/30 scale-105"
                  : "bg-mint-50 text-mint-700 border border-mint-100"
              }`}
            >
              <User className="h-7 w-7" />
            </div>

            <div className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider text-mint-700 bg-mint-100/80 mb-2">
              {isTa ? "உணவுப் பிரியர் / விருந்தினர்" : "Foodie / Customer"}
            </div>

            <h3 className="text-xl sm:text-2xl font-black text-slate-950 mb-2">
              {isTa ? "வாடிக்கையாளர்" : "Customer"}
            </h3>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium mb-4">
              {isTa
                ? "டிஜிட்டல் மெனுக்களை உலாவவும், கடைகளை வரைபடமாக்கவும் மற்றும் நேரடியாக ஆர்டர் செய்யவும்."
                : "I am a customer looking to browse digital menus, locate local shops, and order."}
            </p>

            <ul className="space-y-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-700">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "QR டிஜிட்டல் மெனு" : "Contactless QR Digital Menu"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "அருகிலுள்ள கடைகளை கண்டறியவும்" : "Locate Nearby Shops"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "நேரடி ஆர்டர் & டேக்அவே" : "Instant Table & Takeaway Ordering"}</span>
              </li>
            </ul>
          </motion.div>

          {/* ── CARD 3: EMPLOYEE ── */}
          <motion.div
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setSelectedRole("employee")}
            className={`relative rounded-3xl p-6 sm:p-7 cursor-pointer transition-all duration-300 ${
              selectedRole === "employee"
                ? "border-2 border-mint-500 bg-gradient-to-b from-mint-50/90 via-white to-mint-50/40 shadow-xl shadow-mint-500/15 ring-4 ring-mint-500/10 scale-[1.02]"
                : "border border-slate-200/90 bg-white/90 shadow-sm hover:border-mint-300 hover:shadow-md"
            }`}
          >
            {/* Selection Checkmark Badge */}
            {selectedRole === "employee" && (
              <div className="absolute top-4 right-4 inline-flex items-center gap-1 bg-mint-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm animate-in fade-in zoom-in duration-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{isTa ? "தேர்வுசெய்யப்பட்டது" : "Selected"}</span>
              </div>
            )}

            <div
              className={`h-14 w-14 rounded-2xl flex items-center justify-center mb-5 transition-colors ${
                selectedRole === "employee"
                  ? "bg-mint-500 text-white shadow-lg shadow-mint-500/30 scale-105"
                  : "bg-mint-50 text-mint-700 border border-mint-100"
              }`}
            >
              <UtensilsCrossed className="h-7 w-7" />
            </div>

            <div className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider text-mint-700 bg-mint-100/80 mb-2">
              {isTa ? "ஊழியர் / பணியாளர்" : "Shop Staff / Team Member"}
            </div>

            <h3 className="text-xl sm:text-2xl font-black text-slate-950 mb-2">
              {isTa ? "ஊழியர்" : "Employee"}
            </h3>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium mb-4">
              {isTa
                ? "பணிகளைப் பார்க்கவும், இருப்புப் பொருட்களைப் புதுப்பிக்கவும் மற்றும் அறிவிப்புகளைப் பெறவும்."
                : "I am a registered employee. Access assigned tasks, manage stock availability, and receive notifications."}
            </p>

            <ul className="space-y-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-700">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "ஒதுக்கப்பட்ட பணிகள்" : "View Assigned Tasks"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "இருப்பு புதுப்பிப்பு" : "Update Stock Availability"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                <span>{isTa ? "நேரடி அறிவிப்புகள்" : "Realtime Task Notifications"}</span>
              </li>
            </ul>
          </motion.div>
        </div>

        {/* Continue Action */}
        <div className="flex flex-col items-center gap-3">
          <Button
            size="lg"
            onClick={handleContinue}
            disabled={!selectedRole}
            rightIcon={<ArrowRight className="h-5 w-5" />}
            className={`w-full sm:w-80 h-13 text-base font-extrabold shadow-lg transition-all duration-300 ${
              selectedRole
                ? "bg-mint-500 hover:bg-mint-600 text-white shadow-mint-500/30 scale-100 hover:scale-[1.02]"
                : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
            }`}
          >
            {isTa ? "தொடரவும்" : "Continue"}
          </Button>

          <p className="text-center text-xs font-semibold text-slate-400">
            {selectedRole
              ? isTa
                ? "அடுத்த கட்டத்திற்குச் செல்ல 'தொடரவும்' என்பதைக் கிளிக் செய்யவும்."
                : `Proceeding as ${selectedRole === "shopkeeper" ? "Shopkeeper" : selectedRole === "employee" ? "Employee" : "Customer"}`
              : isTa
                ? "தொடர ஒரு பாத்திரத்தைத் தேர்ந்தெடுக்கவும்"
                : "Please select a role above to continue"}
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs font-medium text-slate-500 mt-10">
          {landT.footerDesc}
        </p>
      </motion.div>
    </div>
  );
}

export default function SelectRolePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-white text-slate-500 font-semibold">
          Loading...
        </div>
      }
    >
      <RoleSelectionContent />
    </Suspense>
  );
}
