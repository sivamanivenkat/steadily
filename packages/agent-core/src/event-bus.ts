import { parseNewEvent, type NewEvent, type StoredEvent } from '@steadily/shared-types';
import type { EventStore, SequencedEvent } from './event-store';

/** Injected time source, so tests and replays are deterministic. */
export type Clock = () => Date;

/** Injected id source. React Native may need expo-crypto instead of the global. */
export type IdGenerator = () => string;

export const systemClock: Clock = () => new Date();
/** Web Crypto, available in Node 22 and Hermes builds with a crypto polyfill. */
export const randomId: IdGenerator = () =>
  (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();

export interface EventBusOptions {
  store: EventStore;
  clock?: Clock;
  newId?: IdGenerator;
}

export class EventBus {
  readonly store: EventStore;
  private readonly clock: Clock;
  private readonly newId: IdGenerator;

  constructor(options: EventBusOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.newId = options.newId ?? randomId;
  }

  /**
   * Validates every event with `parseNewEvent` and stamps id, at and
   * causationId. Throws (without storing anything) if any event is invalid.
   */
  prepare(newEvents: readonly NewEvent[], causationId: string | null): StoredEvent[] {
    const validated = newEvents.map((event) => parseNewEvent(event));
    const at = this.clock().toISOString();
    return validated.map(
      (event) => ({ ...event, id: this.newId(), at, causationId }) as StoredEvent,
    );
  }

  /** Validates, stamps and appends. All-or-nothing on validation. */
  async publish(
    newEvents: readonly NewEvent[],
    causationId: string | null,
  ): Promise<SequencedEvent[]> {
    const prepared = this.prepare(newEvents, causationId);
    if (prepared.length === 0) return [];
    return this.store.append(prepared);
  }
}
