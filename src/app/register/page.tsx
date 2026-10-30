"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, User, ArrowRight, ArrowLeft, Languages } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";

export default function RegisterPage() {
  const router = useRouter();
  const { lang, toggleLang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"].authPages;
  const landT = DASHBOARD_TRANSLATIONS[lang || "en"].landingPage;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      // 1. Create the auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (authError) {
        toast.error(authError.message);
        return;
      }

      if (!authData.user) {
        toast.error("Registration failed. Please try again.");
        return;
      }

      if (!authData.session) {
        toast.success(
          "Account created! A confirmation link has been sent to your registered email address. Please check your inbox to confirm."
        );
        router.push("/login");
        router.refresh();
        return;
      }

      // 2. Create the profile record if it does not exist yet
      const { data: existingProfile, error: profileCheckError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileCheckError && profileCheckError.code !== "PGRST116") {
        console.warn("Profile lookup warning:", profileCheckError.message);
      }

      if (!existingProfile) {
        const { error: profileError } = await supabase.from("profiles").insert({
          id: authData.user.id,
          email,
          full_name: fullName,
          role: "shopkeeper",
        });

        if (profileError) {
          const message =
            profileError.code === "42P01"
              ? "The Supabase database tables are not set up yet. Please run the SQL schema in your Supabase project."
              : profileError.message;

          console.warn("Profile creation skipped:", message);
          toast.message(
            "Account created, but the profile setup needs one more step."
          );
        }
      }

      toast.success("Account created! Welcome to BISHOP.");
      router.push("/shop/setup");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-shell bg-white min-h-dvh flex items-center justify-center p-4 sm:p-6 relative pt-16 sm:pt-6">
      {/* Back Navigation & Language Switcher */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50">
        <Link 
          href="/" 
          className="inline-flex items-center justify-center h-10 w-10 sm:h-11 sm:w-11 bg-mint-50 hover:bg-mint-100 rounded-full text-mint-600 hover:text-mint-700 transition-all shadow-sm shadow-black/5 hover:shadow-md hover:shadow-mint-500/20 hover:scale-105 backdrop-blur-sm"
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
          {lang === "en" ? "தமிழ்" : "English"}
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
        className="w-full max-w-lg relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-10">
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
          <div className="soft-pill inline-flex items-center rounded-full px-4 py-1.5 text-base font-semibold mb-5 mt-2">
            {t.registerTitle}
          </div>
          <p className="text-slate-600 text-base font-medium">
            {t.registerSubtitle}
          </p>
        </div>

        {/* Register Card */}
        <Card padding="lg" className="auth-card rounded-2xl bg-mint-50 border border-mint-100 shadow-lg shadow-mint-500/10">
          <form onSubmit={handleRegister} className="flex flex-col gap-5">
            <Input
              label={t.fullNameLabel}
              type="text"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              leftIcon={<User className="h-4 w-4" />}
              required
              autoComplete="name"
            />

            <Input
              label={t.emailLabel}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              leftIcon={<Mail className="h-4 w-4" />}
              required
              autoComplete="email"
            />

            <Input
              label={t.passwordLabel}
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leftIcon={<Lock className="h-4 w-4" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
              required
              autoComplete="new-password"
            />

            <Input
              label={t.confirmPasswordLabel}
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              leftIcon={<Lock className="h-4 w-4" />}
              required
              autoComplete="new-password"
            />

            <Button
              type="submit"
              size="lg"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="w-full mt-1"
            >
              {t.registerBtn}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-center text-sm font-medium text-slate-600">
              {t.haveAccount}{" "}
              <Link
                href="/login"
                className="font-bold text-mint-600 hover:text-mint-700 transition-colors"
              >
                {t.loginLink}
              </Link>
            </p>
          </div>
        </Card>

        {/* Footer */}
        <p className="text-center text-sm font-medium text-slate-500 mt-8">
          {landT.footerDesc}
        </p>
      </motion.div>
    </div>
  );
}
