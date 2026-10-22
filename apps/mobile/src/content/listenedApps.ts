/**
 * Which apps' notifications Steadily looks at on Android, for the Privacy screen. Derived from
 * the rule packs' `androidPackages`, the same files the native listener bundles as its
 * allow-list, plus the text message apps the listener reads (`SMS_PACKAGES` in
 * modules/steadily-capture CaptureEngine.kt; a test keeps the two lists equal).
 */
import { BUILT_IN_PACKS, type RulePack } from '@steadily/rule-packs';

/** Messaging apps whose notifications are checked for bank texts, with the names people know. */
export const TEXT_MESSAGE_APPS: readonly { androidPackage: string; name: string }[] = [
  { androidPackage: 'com.google.android.apps.messaging', name: 'Google Messages' },
  { androidPackage: 'com.samsung.android.messaging', name: 'Samsung Messages' },
  { androidPackage: 'com.android.mms', name: 'Built-in Messaging app' },
  { androidPackage: 'com.oneplus.mms', name: 'OnePlus Messages' },
  { androidPackage: 'com.android.messaging', name: 'Built-in Messaging app' },
];

export type ListenedApp = {
  /** Human name, e.g. "Chase". */
  name: string;
  androidPackages: string[];
  /** Other packs that read alerts in this app too, e.g. Zelle payments in a bank app. */
  alsoReads: string[];
};

/**
 * One entry per app, named after the pack that owns the package (the first pack listing it, so a
 * bank app is named after the bank even when the Zelle pack also reads it).
 */
export function listenedBankApps(packs: readonly RulePack[] = BUILT_IN_PACKS): ListenedApp[] {
  const byPackage = new Map<string, ListenedApp>();
  const apps: ListenedApp[] = [];
  for (const pack of packs) {
    for (const androidPackage of pack.sources.androidPackages) {
      const owner = byPackage.get(androidPackage);
      if (owner) {
        if (owner.name !== pack.displayName && !owner.alsoReads.includes(pack.displayName)) {
          owner.alsoReads.push(pack.displayName);
        }
        continue;
      }
      const existing = apps.find((app) => app.name === pack.displayName);
      const app = existing ?? { name: pack.displayName, androidPackages: [], alsoReads: [] };
      app.androidPackages.push(androidPackage);
      if (!existing) apps.push(app);
      byPackage.set(androidPackage, app);
    }
  }
  return apps;
}

/** Distinct names of the text message apps. */
export function textMessageAppNames(): string[] {
  return [...new Set(TEXT_MESSAGE_APPS.map((app) => app.name))];
}
