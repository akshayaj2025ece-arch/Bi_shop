/**
 * BISHOP Server-Side Order Processing Domain Module
 * Exports order placement, inventory deduction, and rollback services.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/orders' cannot be executed in browser context.");
}

export * from "./order-service";
export * from "./payment-service";
