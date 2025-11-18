import Stripe from 'stripe';
import { errors } from '@strapi/utils';

import { STRIPE_API_VERSION } from '../../stripe/constants';
import { resolvePluginConfig } from '../../stripe/config';
import { buildStripeMetadata, type MetadataEntry } from '../../stripe/metadata';

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
  return resolvePluginConfig(strapi).secretKey;
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

    throw new errors.ApplicationError(`Failed to create Stripe product: ${reason}`);
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
