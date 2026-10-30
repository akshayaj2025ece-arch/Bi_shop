/**
 * Server-side re-export of password validation policy for BISHOP.
 * The core validation algorithm is shared with client-side UI feedback.
 */
export {
  validatePasswordPolicy,
  type PasswordPolicyResult,
} from "@/lib/auth/password";
