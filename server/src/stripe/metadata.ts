import type Stripe from 'stripe';

export type MetadataEntry = {
  __component?: string;
  key?: string | null;
  value?: string | null;
};

export const buildStripeMetadata = (
  entries: MetadataEntry[] | null | undefined
): Record<string, string> | undefined => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return undefined;
  }

  return entries.reduce<Record<string, string>>((acc, entry) => {
    if (!entry || typeof entry.key !== 'string') {
      return acc;
    }

    const key = entry.key.trim();

    if (!key) {
      return acc;
    }

    const value = entry.value ?? '';

    acc[key] = String(value);

    return acc;
  }, {});
};

export const buildComponentMetadata = (
  metadata: Stripe.Metadata | null | undefined
): MetadataEntry[] => {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  return Object.entries(metadata).reduce<MetadataEntry[]>((acc, [key, value]) => {
    if (!key) {
      return acc;
    }

    acc.push({ key, value: value != null ? String(value) : '' });

    return acc;
  }, []);
};
