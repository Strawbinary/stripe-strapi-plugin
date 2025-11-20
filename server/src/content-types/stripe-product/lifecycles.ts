import Stripe from 'stripe';
import { errors } from '@strapi/utils';

import { isRunningInStripeSyncContext } from '../../stripe/lifecycle-context';
import { buildStripeMetadata, type MetadataEntry } from '../../stripe/metadata';
import { getStripeClient } from '../../stripe/client';

type StripeProductLifecycleData = {
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  taxCode?: string | null;
  active?: boolean | null;
  metadata?: MetadataEntry[] | null;
  stripeProductId?: string | null;
};

type LifecycleEvent = {
  params?: {
    data?: StripeProductLifecycleData;
  };
  state?: {
    entry?: StripeProductLifecycleData;
  };
  result?: StripeProductLifecycleData;
};

const createStripeProduct = async (data: StripeProductLifecycleData) => {
  const stripe = getStripeClient();
  const metadata = buildStripeMetadata(data.metadata ?? []);

  try {
    const product = await stripe.products.create({
      name: data.name ?? undefined,
      description: data.description ?? undefined,
      active: data.active ?? true,
      tax_code: data.taxCode ?? undefined,
      images: data.imageUrl ? [data.imageUrl] : undefined,
      metadata,
    });

    if (!product?.id) {
      throw new Error('Stripe did not return a product ID.');
    }

    data.stripeProductId = product.id;
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to create Stripe product.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to create Stripe product: ${reason}`);
  }
};

const hasOwnProperty = <T extends object>(obj: T, key: keyof T) => {
  return Object.prototype.hasOwnProperty.call(obj, key);
};

const buildUpdatePayload = (data: StripeProductLifecycleData): Stripe.ProductUpdateParams => {
  const payload: Stripe.ProductUpdateParams = {};

  if (hasOwnProperty(data, 'name')) {
    payload.name = data.name ?? undefined;
  }

  if (hasOwnProperty(data, 'description')) {
    payload.description = data.description ?? undefined;
  }

  if (hasOwnProperty(data, 'active')) {
    payload.active = data.active ?? undefined;
  }

  if (hasOwnProperty(data, 'taxCode')) {
    payload.tax_code = data.taxCode ?? undefined;
  }

  if (hasOwnProperty(data, 'imageUrl')) {
    payload.images = data.imageUrl ? [data.imageUrl] : [];
  }

  if (hasOwnProperty(data, 'metadata')) {
    payload.metadata = buildStripeMetadata(data.metadata ?? []) ?? {};
  }

  return payload;
};

const updateStripeProduct = async (stripeProductId: string, data: StripeProductLifecycleData) => {
  const payload = buildUpdatePayload(data);

  if (Object.keys(payload).length === 0) {
    return;
  }

  try {
    const stripe = getStripeClient();

    await stripe.products.update(stripeProductId, payload);
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to update Stripe product.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to update Stripe product: ${reason}`);
  }
};

const deleteStripeProduct = async (stripeProductId: string) => {
  try {
    const stripe = getStripeClient();

    await stripe.products.del(stripeProductId);
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to delete Stripe product.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to delete Stripe product: ${reason}`);
  }
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const shouldSkipStripeSync = () => {
  return isRunningInStripeSyncContext();
};

const resolveStripeProductIdForEvent = (event: LifecycleEvent) => {
  if (isNonEmptyString(event.params?.data?.stripeProductId)) {
    return event.params?.data?.stripeProductId ?? null;
  }

  if (isNonEmptyString(event.state?.entry?.stripeProductId)) {
    return event.state?.entry?.stripeProductId ?? null;
  }

  if (isNonEmptyString(event.result?.stripeProductId)) {
    return event.result.stripeProductId ?? null;
  }

  return null;
};

export default {
  async beforeCreate(event: LifecycleEvent) {
    const data = event.params?.data;

    if (!data || data.stripeProductId) {
      return;
    }

    await createStripeProduct(data);
  },

  async beforeUpdate(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const data = event.params?.data;

    if (!data) {
      return;
    }

    const stripeProductId = resolveStripeProductIdForEvent(event);

    if (!stripeProductId) {
      return;
    }

    await updateStripeProduct(stripeProductId, data);
  },

  async afterDelete(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const stripeProductId = resolveStripeProductIdForEvent(event);

    if (!stripeProductId) {
      return;
    }

    await deleteStripeProduct(stripeProductId);
  },
};
