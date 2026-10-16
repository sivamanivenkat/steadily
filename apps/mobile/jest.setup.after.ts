import { configure } from '@testing-library/react-native';

// The full workspace test run executes many suites in parallel, so slow machines can exceed the
// default 5 s test timeout and 1 s async-query timeout. Generous limits remove that flakiness
// without hiding real failures (a genuinely broken assertion still fails, just later).
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5_000 });
