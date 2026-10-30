"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Languages,
  Clock,
  CheckCircle2,
  XCircle,
  KeyRound,
  ShieldAlert,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import Link from "next/link";
import Image from "next/image";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { validatePasswordPolicy } from "@/lib/auth/password";

type AuthMode = "login" | "forgot" | "verify_otp" | "new_password" | "reset_success";

export default function LoginPage() {
  const router = useRouter();
  const { lang, toggleLang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"].authPages;
  const landT = DASHBOARD_TRANSLATIONS[lang || "en"].landingPage;

  // View Mode
  const [mode, setMode] = useState<AuthMode>("login");

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Rate Limiting & Lockout state (Enforced Server-Side)
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [isMaxAttemptsLocked, setIsMaxAttemptsLocked] = useState(false);

  // Forgot Password flow state
  const [forgotEmail, setForgotEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);

  // New Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Server-issued reset authorization token (issued ONLY after OTP verification)
  const [resetAuthorizationToken, setResetAuthorizationToken] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Handle URL callback parameters on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const callbackError = searchParams.get("error");
      if (callbackError === "auth_callback_error") {
        toast.error("Email confirmation link was invalid or has expired. Please sign in or request a new link.");
      }
      const modeParam = searchParams.get("mode");
      if (modeParam === "forgot") {
        setMode("forgot");
        const emailParam = searchParams.get("email");
        if (emailParam) {
          setForgotEmail(emailParam);
        }
      }
    } catch {
      // ignore param parse errors
    }
  }, []);

  // Live 30-Second Login Lockout Countdown Timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;

    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // Live 60-Second Resend Code Cooldown Timer
  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;

    const timer = setInterval(() => {
      setResendCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  // Handle Login Submission via Server API (/api/auth/login)
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (lockoutSeconds > 0 || isMaxAttemptsLocked) return;

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.status === "max_attempts") {
          setIsMaxAttemptsLocked(true);
          toast.error("Maximum login attempts reached. Please contact the owner.");
        } else if (data.status === "locked" && data.remainingSeconds) {
          setLockoutSeconds(data.remainingSeconds);
          toast.error(`Too many failed attempts. Temporary lockout active for ${data.remainingSeconds} seconds.`);
        } else {
          toast.error(data.error || "Login failed. Please check your credentials.");
        }
        return;
      }

      // Purge any lingering in-memory state or previous user storage
      useAuthStore.getState().reset();

      // Establish session client-side with Supabase
      if (data.session) {
        const supabase = createClient();
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }

      toast.success("Welcome back!");
      router.push("/dashboard");
      router.refresh();
    } catch (err: any) {
      console.error("Login client error:", err);
      toast.error("Unable to connect to authentication server. Please check your network connection.");
    } finally {
      setIsLoading(false);
    }
  }

  // Handle Forgot Password - Step 1: Request 6-Digit OTP Code
  async function handleRequestOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!forgotEmail || !forgotEmail.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }

    if (resendCooldownSeconds > 0) {
      toast.error(`Please wait ${resendCooldownSeconds} seconds before requesting another code.`);
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.retryAfterSeconds) {
          setResendCooldownSeconds(data.retryAfterSeconds);
        }
        toast.error(data.error || "Failed to send verification code.");
        return;
      }

      setResendCooldownSeconds(60); // 60-second cooldown on resends
      toast.success(data.message || "Verification code sent to your email.");
      setMode("verify_otp");
    } catch (err: any) {
      toast.error("Network error. Please try requesting code again.");
    } finally {
      setIsLoading(false);
    }
  }

  // Handle Step 2: Verify 6-Digit OTP Code
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otpCode || otpCode.trim().length < 6) {
      toast.error("Please enter the complete 6-digit verification code.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, code: otpCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok || !data.success || !data.reset_authorization_token) {
        toast.error(data.error || "Invalid or expired verification code.");
        return;
      }

      setResetAuthorizationToken(data.reset_authorization_token);
      if (data.access_token) setAccessToken(data.access_token);

      toast.success("Code verified successfully! Please enter your new password.");
      setMode("new_password");
    } catch (err: any) {
      toast.error("Failed to verify code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // Handle Step 3: Set New Password
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();

    if (!resetAuthorizationToken) {
      toast.error("Unauthorized: You must verify your email with the 6-digit code first.");
      setMode("forgot");
      return;
    }

    const policy = validatePasswordPolicy(newPassword);
    if (!policy.isValid) {
      toast.error(policy.errors[0] || "Password does not meet security requirements.");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("New Password and Confirm Password do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotEmail,
          reset_authorization_token: resetAuthorizationToken,
          access_token: accessToken,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error(data.error || "Failed to set new password.");
        return;
      }

      toast.success(data.message || "Password Updated Successfully");

      // Reset recovery flow states and transition to dedicated success screen
      setEmail(forgotEmail);
      setPassword("");
      setForgotEmail("");
      setOtpCode("");
      setNewPassword("");
      setConfirmPassword("");
      setResetAuthorizationToken(null);
      setAccessToken(null);
      setIsMaxAttemptsLocked(false);
      setLockoutSeconds(0);
      setMode("reset_success");
    } catch (err: any) {
      toast.error("An error occurred while setting new password.");
    } finally {
      setIsLoading(false);
    }
  }

  // Password Policy Checklist Flags for Step 3
  const policyCheck = validatePasswordPolicy(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

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
            {t.secureAccess}
          </div>
          <p className="text-slate-600 text-base font-medium">
            {mode === "login"
              ? t.signInSubtitle
              : mode === "forgot"
              ? "Enter your email address to receive a 6-digit verification code."
              : mode === "verify_otp"
              ? "Enter the 6-digit verification code sent to your email."
              : mode === "new_password"
              ? "Set a strong new password for your BISHOP account."
              : "Your password has been reset successfully."}
          </p>
        </div>

        {/* Auth Card Container */}
        <Card padding="lg" className="auth-card rounded-2xl bg-mint-50 border border-mint-100 shadow-lg shadow-mint-500/10">
          <AnimatePresence mode="wait">
            {/* ── MODE 1: BISHOP LOGIN SCREEN ── */}
            {mode === "login" && (
              <motion.div
                key="login_form"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                {/* 15 Maximum Attempts Lock Banner */}
                {isMaxAttemptsLocked && (
                  <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs sm:text-sm font-semibold flex items-start gap-3 shadow-2xs">
                    <ShieldAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-red-900">Account Locked</p>
                      <p className="mt-0.5 text-red-700">
                        Maximum login attempts reached. Please contact the owner.
                      </p>
                    </div>
                  </div>
                )}

                {/* 30-Second Lockout Live Countdown Alert */}
                {!isMaxAttemptsLocked && lockoutSeconds > 0 && (
                  <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs sm:text-sm font-semibold flex items-center justify-between shadow-2xs animate-pulse">
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-amber-600 shrink-0" />
                      <span>Too many wrong attempts. Temporary lockout active.</span>
                    </div>
                    <span className="bg-amber-200 text-amber-900 font-extrabold px-3 py-1 rounded-lg text-sm font-mono shrink-0 ml-2">
                      {lockoutSeconds}s
                    </span>
                  </div>
                )}

                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  <Input
                    label={t.emailLabel}
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    leftIcon={<Mail className="h-4 w-4" />}
                    required
                    disabled={isMaxAttemptsLocked || lockoutSeconds > 0}
                    autoComplete="email"
                  />

                  <div>
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
                      disabled={isMaxAttemptsLocked || lockoutSeconds > 0}
                      autoComplete="current-password"
                    />

                    {/* FORGOT PASSWORD LINK */}
                    <div className="flex justify-end mt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(email);
                          setMode("forgot");
                        }}
                        className="text-xs font-bold text-mint-700 hover:text-mint-800 hover:underline transition-all"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    isLoading={isLoading}
                    disabled={isMaxAttemptsLocked || lockoutSeconds > 0}
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                    className="w-full mt-2"
                  >
                    {isMaxAttemptsLocked
                      ? "Account Locked"
                      : lockoutSeconds > 0
                      ? `Locked (${lockoutSeconds}s)`
                      : t.signInBtn}
                  </Button>
                </form>

                <div className="mt-6 pt-5 border-t border-slate-100">
                  <p className="text-center text-sm font-medium text-slate-600">
                    {t.noAccount}{" "}
                    <Link
                      href="/register"
                      className="font-bold text-mint-600 hover:text-mint-700 transition-colors"
                    >
                      {t.registerLink}
                    </Link>
                  </p>
                </div>
              </motion.div>
            )}

            {/* ── MODE 2: STEP 1 - ENTER EMAIL & SEND CODE ── */}
            {mode === "forgot" && (
              <motion.div
                key="forgot_form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <div className="flex items-center gap-2 mb-2 text-mint-900 font-extrabold text-lg">
                  <KeyRound className="h-5 w-5 text-mint-600 shrink-0" />
                  <span>Forgot Password</span>
                </div>

                <p className="text-xs text-slate-600 mb-5 leading-relaxed">
                  Enter your registered email address. We will send a 6-digit verification code to your email.
                </p>

                <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="you@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    leftIcon={<Mail className="h-4 w-4" />}
                    required
                    autoComplete="email"
                  />

                  <div className="flex items-center gap-3 mt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setMode("login")}
                      className="w-1/3 text-slate-600 hover:bg-slate-100 font-bold"
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      size="lg"
                      isLoading={isLoading}
                      rightIcon={<ArrowRight className="h-4 w-4" />}
                      className="w-2/3"
                    >
                      Send Code
                    </Button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* ── MODE 3: STEP 2 - ENTER 6-DIGIT CODE & VERIFY ── */}
            {mode === "verify_otp" && (
              <motion.div
                key="verify_otp_form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <div className="flex items-center gap-2 mb-2 text-mint-900 font-extrabold text-lg">
                  <KeyRound className="h-5 w-5 text-mint-600 shrink-0" />
                  <span>Enter Verification Code</span>
                </div>

                <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                  A 6-digit verification code has been sent to{" "}
                  <strong className="text-slate-800">{forgotEmail}</strong>.
                </p>

                <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
                  <Input
                    label="Verification Code (6 Digits)"
                    type="text"
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    className="tracking-[0.5em] font-mono text-center text-xl font-bold"
                    required
                    maxLength={6}
                    autoComplete="one-time-code"
                  />

                  {/* Code Expiry & Resend Rate Limit Banner */}
                  <div className="p-3 bg-white/90 rounded-xl border border-mint-200/80 flex items-center justify-between text-xs text-slate-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock className="h-3.5 w-3.5 text-mint-600 shrink-0" />
                      Code expires in 10 mins
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRequestOtp()}
                      disabled={isLoading || resendCooldownSeconds > 0}
                      className="font-bold text-mint-700 hover:text-mint-800 disabled:opacity-50 disabled:no-underline flex items-center gap-1 transition-all"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {resendCooldownSeconds > 0 ? `Resend (${resendCooldownSeconds}s)` : "Resend Code"}
                    </button>
                  </div>

                  <div className="flex items-center gap-3 mt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setMode("forgot")}
                      className="w-1/3 text-slate-600 hover:bg-slate-100 font-bold"
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      size="lg"
                      isLoading={isLoading}
                      rightIcon={<ArrowRight className="h-4 w-4" />}
                      className="w-2/3"
                    >
                      Verify Code
                    </Button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* ── MODE 4: STEP 3 - NEW PASSWORD & CONFIRM PASSWORD ── */}
            {mode === "new_password" && resetAuthorizationToken && (
              <motion.div
                key="new_password_form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <div className="flex items-center gap-2 mb-2 text-mint-900 font-extrabold text-lg">
                  <Lock className="h-5 w-5 text-mint-600 shrink-0" />
                  <span>Set New Password</span>
                </div>

                <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                  Enter your new password complying with security requirements.
                </p>

                <form onSubmit={handleSetPassword} className="flex flex-col gap-4">
                  <Input
                    label="New Password"
                    type={showNewPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    leftIcon={<Lock className="h-4 w-4" />}
                    rightIcon={
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                        tabIndex={-1}
                      >
                        {showNewPassword ? (
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
                    label="Confirm Password"
                    type={showNewPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    leftIcon={<Lock className="h-4 w-4" />}
                    required
                    autoComplete="new-password"
                  />

                  {/* Password Policy Requirements Checklist */}
                  <div className="bg-white/80 p-3 rounded-xl border border-mint-200/80 space-y-1.5 text-xs text-slate-700">
                    <p className="font-bold text-slate-900 mb-1">Password Requirements:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      <div className="flex items-center gap-1.5">
                        {policyCheck.hasMinLength ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-mint-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className={policyCheck.hasMinLength ? "text-mint-800 font-semibold" : "text-slate-500"}>
                          At least 8 characters
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {policyCheck.hasUppercase ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-mint-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className={policyCheck.hasUppercase ? "text-mint-800 font-semibold" : "text-slate-500"}>
                          One uppercase (A-Z)
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {policyCheck.hasLowercase ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-mint-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className={policyCheck.hasLowercase ? "text-mint-800 font-semibold" : "text-slate-500"}>
                          One lowercase (a-z)
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {policyCheck.hasNumber ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-mint-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className={policyCheck.hasNumber ? "text-mint-800 font-semibold" : "text-slate-500"}>
                          One number (0-9)
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {policyCheck.hasSpecialChar ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-mint-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className={policyCheck.hasSpecialChar ? "text-mint-800 font-semibold" : "text-slate-500"}>
                          One special char (!@#...)
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {passwordsMatch ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-mint-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className={passwordsMatch ? "text-mint-800 font-semibold" : "text-slate-500"}>
                          Passwords match
                        </span>
                      </div>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    isLoading={isLoading}
                    disabled={!policyCheck.isValid || !passwordsMatch || !resetAuthorizationToken}
                    className="w-full mt-2"
                  >
                    Set Password
                  </Button>
                </form>
              </motion.div>
            )}

            {/* ── MODE 5: STEP 4 - PASSWORD RESET SUCCESS ── */}
            {mode === "reset_success" && (
              <motion.div
                key="reset_success_view"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="text-center py-2"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-4 shadow-sm shadow-emerald-500/10">
                  <CheckCircle2 className="h-9 w-9 text-emerald-600" />
                </div>

                <h3 className="text-xl font-extrabold text-slate-900 mb-2">
                  Password Reset Successful!
                </h3>

                <p className="text-sm text-slate-600 mb-6 leading-relaxed max-w-sm mx-auto">
                  Your password has been securely updated. You can now log in to your BISHOP account with your new credentials.
                </p>

                <Button
                  type="button"
                  size="lg"
                  onClick={() => {
                    setPassword("");
                    setIsMaxAttemptsLocked(false);
                    setLockoutSeconds(0);
                    setMode("login");
                  }}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                  className="w-full"
                >
                  Return to Login
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Footer */}
        <p className="text-center text-sm font-medium text-slate-500 mt-8">
          {landT.footerDesc}
        </p>
      </motion.div>
    </div>
  );
}
