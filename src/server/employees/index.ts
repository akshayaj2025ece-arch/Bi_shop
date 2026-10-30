/**
 * BISHOP Server-Side Employee Management Domain Module
 * Exports employee creation, provisioning, and profile handling services.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/employees' cannot be executed in browser context.");
}

export * from "./employee-service";
export * from "./employee-verify-service";
