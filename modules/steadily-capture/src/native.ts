import { requireOptionalNativeModule } from 'expo';

/** The raw native surface. Every call returns plain values; validation happens in `index.ts`. */
export interface SteadilyCaptureNative {
  isListenerEnabled(): boolean;
  openListenerSettings(): boolean;
  openBatterySettings(): boolean;
  getPendingCount(): number;
  getHealth(): unknown;
  peekPending(limit: number): Promise<string[]>;
  ackPending(ids: string[]): Promise<number>;
}

/** The module, or null when it is not linked (iOS, web, Jest, Expo Go). */
export function getNativeModule(): SteadilyCaptureNative | null {
  return requireOptionalNativeModule<SteadilyCaptureNative>('SteadilyCapture');
}
