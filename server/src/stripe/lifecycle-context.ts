import { AsyncLocalStorage } from 'node:async_hooks';

type LifecycleContext = {
  source?: 'stripe-sync' | string | null;
};

const lifecycleContext = new AsyncLocalStorage<LifecycleContext>();

export const runWithStripeSyncContext = async <T>(callback: () => Promise<T> | T): Promise<T> => {
  return lifecycleContext.run({ source: 'stripe-sync' }, callback);
};

export const isRunningInStripeSyncContext = () => {
  return lifecycleContext.getStore()?.source === 'stripe-sync';
};
