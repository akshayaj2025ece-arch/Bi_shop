/**
 * BISHOP Server-Side Inventory Domain Module
 * Exports stock fetching, inventory updates, and menu availability synchronization.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/inventory' cannot be executed in browser context.");
}

export * from "./stock-service";
