import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { getCollectionsData } from '#/lib/collections.server';

type CollectionsData = ReturnType<typeof getCollectionsData>;

const CollectionsDataContext = createContext<CollectionsData | null>(null);

export function CollectionsDataProvider({
  value,
  children,
}: {
  value: CollectionsData;
  children: ReactNode;
}) {
  return (
    <CollectionsDataContext.Provider value={value}>
      {children}
    </CollectionsDataContext.Provider>
  );
}

export function useCollectionsData() {
  const value = useContext(CollectionsDataContext);

  if (!value) {
    throw new Error(
      'useCollectionsData must be used within CollectionsDataProvider',
    );
  }

  return value;
}
