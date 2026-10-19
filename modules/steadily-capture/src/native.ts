import { requireOptionalNativeModule } from 'expo';

/** Returned by `addListener`; call `remove` to unsubscribe. */
export interface CaptureSubscription {
  remove(): void;
}

/** The raw native surface. Every call returns plain values; validation happens in `index.ts`. */
export interface SteadilyCaptureNative {
  isListenerEnabled(): boolean;
  openListenerSettings(): boolean;
  openBatterySettings(): boolean;
  getPendingCount(): number;
  getHealth(): unknown;
  peekPending(limit: number): Promise<string[]>;
  ackPending(ids: string[]): Promise<number>;
  setCaptureNotificationsEnabled(enabled: boolean): void;
  getCaptureNotificationsEnabled(): boolean;
  canPostCaptureNotifications(): boolean;
  /** Event emitter surface of Expo native modules. Payloads are validated in `index.ts`. */
  addListener?(
    eventName: 'onPendingCapture',
    listener: (event: unknown) => void,
  ): CaptureSubscription;
}

/** The module, or null when it is not linked (iOS, web, Jest, Expo Go). */
export function getNativeModule(): SteadilyCaptureNative | null {
  return requireOptionalNativeModule<SteadilyCaptureNative>('SteadilyCapture');
}
