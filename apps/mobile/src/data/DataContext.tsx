import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { DataSource } from './DataSource';

type DataContextValue = { source: DataSource; version: number };

const DataContext = createContext<DataContextValue | null>(null);

/**
 * Makes a `DataSource` available to screens. Every write in the source bumps `version`, which
 * makes `useData` queries run again.
 */
export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  useEffect(() => source.subscribe(() => setVersion((v) => v + 1)), [source]);
  return <DataContext.Provider value={{ source, version }}>{children}</DataContext.Provider>;
}

function useDataContext(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useDataSource must be used inside <DataProvider>');
  return value;
}

export function useDataSource(): DataSource {
  return useDataContext().source;
}

type QueryState<T> = { data: T | undefined; loading: boolean; error: unknown };

/**
 * Runs an async read against the data source and re-runs it after any write or when `deps`
 * change. Keeps the previous result while reloading so screens do not flash.
 */
export function useData<T>(
  query: (source: DataSource) => Promise<T>,
  deps: readonly unknown[] = [],
): QueryState<T> {
  'use no memo';
  const { source, version } = useDataContext();
  const [state, setState] = useState<QueryState<T>>({
    data: undefined,
    loading: true,
    error: undefined,
  });

  // `query` is usually an inline arrow; callers list what it depends on in `deps`.
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    let active = true;
    queryRef.current(source).then(
      (data) => {
        if (active) setState({ data, loading: false, error: undefined });
      },
      (error: unknown) => {
        if (active) setState((prev) => ({ ...prev, loading: false, error }));
      },
    );
    return () => {
      active = false;
    };
  }, [source, version, ...deps]);

  return state;
}

/** "Now" from the data source clock, fixed for the life of the screen. */
export function useNow(): Date {
  const source = useDataSource();
  const [now] = useState(() => source.now());
  return now;
}
