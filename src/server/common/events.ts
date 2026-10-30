/**
 * Server-side Domain Event Dispatcher & Outbox Queue for BISHOP.
 * Implements Topics 15, 16, and 17 (Message Queues, Pub/Sub, Event-Driven Architecture).
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/common/events' cannot be executed in browser context.");
}

export type DomainEventType =
  | "ORDER_CREATED"
  | "ORDER_PAID"
  | "ORDER_STATUS_CHANGED"
  | "ORDER_CANCELLED"
  | "STOCK_LOW"
  | "EMPLOYEE_VERIFIED"
  | "EMPLOYEE_TASK_COMPLETED"
  | "PAYMENT_FAILED";

export interface DomainEvent<T = any> {
  id: string;
  type: DomainEventType;
  payload: T;
  timestamp: string;
}

export interface DeadLetterEntry {
  event: DomainEvent;
  error: string;
  failedAt: string;
  attempts: number;
}

type EventHandler<T = any> = (event: DomainEvent<T>) => Promise<void> | void;

const listeners = new Map<DomainEventType, Set<EventHandler>>();
const deadLetterQueue: DeadLetterEntry[] = [];
const eventLog: DomainEvent[] = [];
const MAX_LOG_SIZE = 500;

/**
 * Subscribes a listener to a domain event.
 */
export function subscribeDomainEvent<T = any>(
  type: DomainEventType,
  handler: EventHandler<T>
): () => void {
  if (!listeners.has(type)) {
    listeners.set(type, new Set());
  }
  listeners.get(type)!.add(handler);

  return () => {
    listeners.get(type)?.delete(handler);
  };
}

/**
 * Emits a domain event to all registered subscribers.
 * Handlers are invoked asynchronously with error capture and Dead-Letter Queue (DLQ) routing.
 */
export function emitDomainEvent<T = any>(
  type: DomainEventType,
  payload: T
): DomainEvent<T> {
  const event: DomainEvent<T> = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    payload,
    timestamp: new Date().toISOString(),
  };

  // Add to bounded event log
  eventLog.push(event);
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.shift();
  }

  // Safe logging without secrets
  console.log(`[EVENT-BUS] Emitted: ${event.type} (${event.id})`);

  const handlers = listeners.get(type);
  if (handlers && handlers.size > 0) {
    for (const handler of handlers) {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err) => {
          console.error(`[EVENT-BUS] Handler failed for event ${event.id}:`, err?.message || err);
          deadLetterQueue.push({
            event,
            error: err?.message || String(err),
            failedAt: new Date().toISOString(),
            attempts: 1,
          });
          if (deadLetterQueue.length > 200) {
            deadLetterQueue.shift();
          }
        });
    }
  }

  return event;
}

/**
 * Returns recent events from the in-memory outbox log for observability.
 */
export function getRecentDomainEvents(): DomainEvent[] {
  return [...eventLog];
}

/**
 * Returns failed events from the Dead-Letter Queue (DLQ).
 */
export function getDeadLetterQueue(): DeadLetterEntry[] {
  return [...deadLetterQueue];
}
