/**
 * BISHOP Server-Side Tasks Domain Module
 * Exports task querying, assignment, status transition, and completion stock increment services.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/tasks' cannot be executed in browser context.");
}

export * from "./task-service";
