/**
 * Stand-in for expo-router in screen tests:
 * `jest.mock('expo-router', () => require('@/testing/router').routerModule);`
 */
export const mockRouter = {
  push: jest.fn(),
  navigate: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

/** Route params screens read with `useLocalSearchParams`. Set in a test, cleared by `resetRouter`. */
export const mockParams: Record<string, string> = {};

export const routerModule = {
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
};

export function resetRouter() {
  Object.values(mockRouter).forEach((fn) => fn.mockClear());
  for (const key of Object.keys(mockParams)) delete mockParams[key];
}
