import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUILT_IN_PACKS } from '@steadily/rule-packs';

import { listenedBankApps, TEXT_MESSAGE_APPS, textMessageAppNames } from '../listenedApps';

const ENGINE_KT = join(
  __dirname,
  '../../../../../modules/steadily-capture/android/src/main/java/expo/modules/steadilycapture/fastpath/CaptureEngine.kt',
);

describe('listened apps', () => {
  const apps = listenedBankApps();

  it('covers every Android package in the rule packs, the native allow-list', () => {
    const listed = new Set(apps.flatMap((app) => app.androidPackages));
    const inPacks = new Set(BUILT_IN_PACKS.flatMap((pack) => pack.sources.androidPackages));
    expect(listed).toEqual(inPacks);
  });

  it('uses human names, never package ids', () => {
    for (const app of apps) expect(app.name).not.toMatch(/^[a-z]+(\.[a-z0-9_]+)+$/);
    expect(apps.map((app) => app.name)).toEqual(expect.arrayContaining(['Chase', 'Venmo']));
    for (const name of textMessageAppNames()) expect(name).not.toContain('.');
  });

  it('names a bank app after the bank, noting Zelle alerts read in it', () => {
    const chase = apps.find((app) => app.name === 'Chase');
    expect(chase?.alsoReads).toContain('Zelle');
    expect(apps.find((app) => app.name === 'Zelle')).toBeUndefined();
  });

  it('packs without Android apps are not listed', () => {
    expect(apps.find((app) => app.name === 'Apple Card')).toBeUndefined();
  });

  it('matches the text message apps the native listener reads', () => {
    const source = readFileSync(ENGINE_KT, 'utf8');
    const block = /SMS_PACKAGES\s*=\s*setOf\(([^)]*)\)/.exec(source)?.[1] ?? '';
    const native = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(native.length).toBeGreaterThan(0);
    expect(new Set(TEXT_MESSAGE_APPS.map((app) => app.androidPackage))).toEqual(new Set(native));
  });
});
