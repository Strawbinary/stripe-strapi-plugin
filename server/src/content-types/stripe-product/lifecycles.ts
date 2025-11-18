import Stripe from 'stripe';
import { errors } from '@strapi/utils';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-10-29.clover';

type MetadataEntry = {
  __component?: string;
  key?: string | null;
  value?: string | null;
};

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
};

const getSecretKey = (): string | null => {
  const pluginConfig = strapi.config.get('plugin.stripe-strapi-plugin', {}) as {
    secretKey?: string;
    stripeSecretKey?: string;
  };

  return (
    pluginConfig.secretKey ??
    pluginConfig.stripeSecretKey ??
    process.env.STRIPE_SECRET_KEY ??
    null
  );
};

const buildStripeMetadata = (entries: MetadataEntry[] | null | undefined) => {
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

const createStripeProduct = async (data: StripeProductLifecycleData) => {
  const secretKey = getSecretKey();

  if (!secretKey) {
    throw new errors.ApplicationError(
      'No Stripe secret key configured. Please configure it in the plugin.'
    );
  }

  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });

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

    throw new errors.ApplicationError(
      `Failed to create Stripe product: ${reason}`
    );
  }
};

export default {
  async beforeCreate(event: LifecycleEvent) {
    const data = event.params?.data;

    if (!data || data.stripeProductId) {
      return;
    }

    await createStripeProduct(data);
  },
};
