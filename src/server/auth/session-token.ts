/**
 * Server-side Cryptographic Session Token Utility for BISHOP.
 * Issues and verifies tamper-proof HMAC-SHA256 tokens for employee sessions.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/auth/session-token' cannot be executed in browser context.");
}

import crypto from "crypto";

export interface EmployeeSessionPayload {
  employee_id: string;
  profile_id: string;
  shop_id: string;
  role: string;
  issued_at: number;
  expires_at: number;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error(
      "FATAL: SESSION_SECRET environment variable is missing or too short (min 16 chars). " +
      "Employee session tokens cannot be signed without a dedicated secret. " +
      "Set SESSION_SECRET in .env.local or your deployment environment."
    );
  }
  return secret;
}

/**
 * Creates a signed, tamper-proof session token for an authenticated employee.
 * Default expiration: 7 days.
 */
export function createEmployeeSessionToken(
  data: Omit<EmployeeSessionPayload, "issued_at" | "expires_at">,
  ttlSeconds: number = 7 * 24 * 60 * 60
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: EmployeeSessionPayload = {
    ...data,
    issued_at: now,
    expires_at: now + ttlSeconds,
  };

  const payloadStr = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadStr, "utf8").toString("base64url");
  const secret = getSessionSecret();

  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies a session token using HMAC-SHA256 and constant-time signature comparison.
 */
export function verifyEmployeeSessionToken(token: string): {
  valid: boolean;
  payload?: EmployeeSessionPayload;
  error?: string;
} {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, error: "Invalid token format." };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed session token." };
  }

  const [encodedPayload, clientSignature] = parts;
  const secret = getSessionSecret();

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const clientSigBuf = Buffer.from(clientSignature, "utf8");
  const expectedSigBuf = Buffer.from(expectedSignature, "utf8");

  if (
    clientSigBuf.length !== expectedSigBuf.length ||
    !crypto.timingSafeEqual(clientSigBuf, expectedSigBuf)
  ) {
    return { valid: false, error: "Token signature verification failed." };
  }

  try {
    const payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as EmployeeSessionPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.expires_at && now > payload.expires_at) {
      return { valid: false, error: "Employee session has expired." };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: "Failed to decode session payload." };
  }
}
