import type { Core } from '@strapi/strapi';
import Stripe from 'stripe';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-10-29.clover';
const STRIPE_PRODUCT_UID = 'plugin::stripe-strapi-plugin.stripe-product';

type StripeProductDocumentsApi = {
  findFirst(params?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  create(params: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type PluginStore = Awaited<ReturnType<Core.Strapi['store']>>;

const runInitialStripeProductMigration = async ({
  strapi,
  secretKey,
  store,
}: {
  strapi: Core.Strapi;
  secretKey: string;
  store: PluginStore;
}): Promise<void> => {
  try {
    const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });

    const documentsApi = (
      strapi as Core.Strapi & { documents?: (uid: string) => StripeProductDocumentsApi }
    ).documents;
    const stripeProductDocuments =
      typeof documentsApi === 'function' ? documentsApi(STRIPE_PRODUCT_UID) : null;

    if (!stripeProductDocuments) {
      strapi.log.error(
        '[stripe-strapi-plugin] Document service API is unavailable. Skipping initial product migration.'
      );
      return;
    }

    let productCount = 0;
    let createdCount = 0;

    for await (const product of stripe.products.list({ limit: 100 })) {
      productCount += 1;
      if (!product?.id) {
        continue;
      }

      const existing = await stripeProductDocuments.findFirst({
        filters: {
          stripeProductId: {
            $eq: product.id,
          },
        },
        status: 'draft',
      });

      if (existing) {
        continue;
      }

      const metadataEntries = Object.entries(product.metadata ?? {}).reduce<
        { key: string; value: string }[]
      >((acc, [key, value]) => {
        if (key) {
          acc.push({ key, value: String(value ?? '') });
        }
        return acc;
      }, []);

      await stripeProductDocuments.create({
        data: {
          name: product.name ?? product.id,
          stripeProductId: product.id,
          description: product.description ?? undefined,
          imageUrl: product.images && product.images.length > 0 ? product.images[0] : undefined,
          taxCode: product.tax_code ?? 'txcd_10000000',
          active: product.active ?? true,
          metadata: metadataEntries.length > 0 ? metadataEntries : [],
        },
        status: 'published',
      });

      createdCount += 1;
    }

    await store.set({
      key: 'initialProductsMigrationCompleted',
      value: {
        completedAt: new Date().toISOString(),
        productCount,
        createdCount,
      },
    });

    strapi.log.info(
      `[stripe-strapi-plugin] Initial Stripe product migration completed. Imported ${createdCount} new products from Stripe.`
    );
  } catch (error) {
    strapi.log.error(
      '[stripe-strapi-plugin] Failed to run initial Stripe product migration.',
      error
    );
  }
};

export default runInitialStripeProductMigration;
