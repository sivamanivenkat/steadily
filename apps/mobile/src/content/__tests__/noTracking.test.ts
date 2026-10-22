import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Privacy screen says no ads, analytics or crash-reporting tools are built in (D-011). This
 * keeps that true: adding one of these fails the build until the screen and D-011 are revisited.
 */
const TRACKING =
  /analytics|amplitude|appsflyer|react-native-adjust|react-native-branch|braze|bugsnag|crashlytics|datadog|firebase|instabug|mixpanel|newrelic|posthog|segment|sentry|onesignal|google-mobile-ads|admob|facebook-sdk|fbsdk|expo-insights|expo-tracking-transparency/i;

const root = join(__dirname, '../../../');

function dependencyNames(packageJson: string): string[] {
  const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as Record<string, unknown>;
  return ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((key) =>
    Object.keys((pkg[key] as Record<string, string> | undefined) ?? {}),
  );
}

describe('no tracking SDKs', () => {
  it('the app depends on none', () => {
    const names = [
      ...dependencyNames(join(root, 'package.json')),
      ...dependencyNames(join(root, '../../modules/steadily-capture/package.json')),
    ];
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => TRACKING.test(name))).toEqual([]);
  });

  it('no config plugin adds one', () => {
    const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
      expo: { plugins?: (string | [string, unknown])[] };
    };
    const plugins = (app.expo.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins.filter((name) => TRACKING.test(name))).toEqual([]);
  });

  it('the native capture module links none', () => {
    const gradle = readFileSync(
      join(root, '../../modules/steadily-capture/android/build.gradle'),
      'utf8',
    );
    expect(gradle).not.toMatch(TRACKING);
  });
});
