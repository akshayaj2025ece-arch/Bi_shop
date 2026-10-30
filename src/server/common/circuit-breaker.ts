/**
 * Server-side Circuit Breaker Utility for BISHOP.
 * Implements Topic 10 (Circuit Breakers).
 * Protects application from cascading failures when upstream services
 * (SMTP server, payment gateway, external SMS) become unresponsive or fail repeatedly.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/common/circuit-breaker' cannot be executed in browser context.");
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold?: number; // Failures before tripping (default: 5)
  resetTimeoutMs?: number;   // Time to wait before testing recovery (default: 30,000ms)
  halfOpenSuccessThreshold?: number; // Successes in half-open before resetting (default: 2)
}

export class CircuitBreaker {
  private name: string;
  private state: CircuitState = "CLOSED";
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private halfOpenSuccessThreshold: number;

  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30000;
    this.halfOpenSuccessThreshold = config.halfOpenSuccessThreshold ?? 2;
  }

  public getState(): CircuitState {
    const now = Date.now();
    if (this.state === "OPEN" && now - this.lastFailureTime > this.resetTimeoutMs) {
      this.state = "HALF_OPEN";
      this.successCount = 0;
      console.log(`[CIRCUIT-BREAKER] ${this.name}: Transitioning from OPEN to HALF_OPEN to test recovery.`);
    }
    return this.state;
  }

  /**
   * Executes a protected call through the circuit breaker.
   */
  public async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "OPEN") {
      console.warn(`[CIRCUIT-BREAKER] ${this.name} is OPEN. Fast-failing without calling external service.`);
      if (fallback) {
        return await fallback();
      }
      throw new Error(`Service Unavailable: ${this.name} circuit is currently open.`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      if (fallback) {
        return await fallback();
      }
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.successCount = 0;
        console.log(`[CIRCUIT-BREAKER] ${this.name}: Successfully recovered! Circuit is now CLOSED.`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(err: any): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    console.error(`[CIRCUIT-BREAKER] ${this.name} recorded failure (${this.failureCount}/${this.failureThreshold}):`, err?.message || err);

    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      console.error(`[CIRCUIT-BREAKER] ${this.name} TRIPPED to OPEN! Blocking traffic for ${this.resetTimeoutMs / 1000}s.`);
    }
  }
}

// Registry for shared breakers
const circuitRegistry = new Map<string, CircuitBreaker>();

export function getOrCreateCircuitBreaker(
  name: string,
  config?: Omit<CircuitBreakerConfig, "name">
): CircuitBreaker {
  if (!circuitRegistry.has(name)) {
    circuitRegistry.set(
      name,
      new CircuitBreaker({
        name,
        ...config,
      })
    );
  }
  return circuitRegistry.get(name)!;
}
