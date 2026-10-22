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

export const routerModule = {
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
};

export function resetRouter() {
  Object.values(mockRouter).forEach((fn) => fn.mockClear());
}
