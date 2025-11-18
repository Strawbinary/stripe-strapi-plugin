import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import Stripe from 'stripe';

import { STRIPE_PRODUCT_UID } from '../constants';
import { STRIPE_API_VERSION } from '../stripe/constants';
import { resolvePluginConfig } from '../stripe/config';
import { buildComponentMetadata } from '../stripe/metadata';

type StripeProductDocumentsApi = ReturnType<Core.Strapi['documents']>;

type UpsertResult = 'created' | 'updated' | null;

const PRODUCT_EVENT_TYPES = new Set(['product.created', 'product.updated']);

const PRODUCT_DELETE_EVENT_TYPES = new Set(['product.deleted']);

const logPrefix = '[stripe-strapi-plugin]';

const createStripeSyncService = ({ strapi }: { strapi: Core.Strapi }) => {
  const getConfig = () => resolvePluginConfig(strapi);

  const getStripeClient = () => {
    const secretKey = getConfig().secretKey;

    if (!secretKey) {
      throw new errors.ApplicationError(
        'No Stripe secret key configured. Please configure it in the plugin.'
      );
    }

    return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  };

  const getDocumentsApi = (): StripeProductDocumentsApi | null => {
    const documentsApi = strapi.documents;

    if (typeof documentsApi !== 'function') {
      strapi.log.error(`${logPrefix} Document service API is unavailable. Skipping Stripe sync.`);
      return null;
    }

    return documentsApi(STRIPE_PRODUCT_UID);
  };

  const findProductDocument = async (stripeProductId: string) => {
    const documentsApi = getDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const existing = await documentsApi.findFirst({
      fields: ['documentId'],
      filters: {
        stripeProductId: {
          $eq: stripeProductId,
        },
      },
    });

    if (existing?.documentId) {
      return { documentId: existing.documentId };
    }

    return null;
  };

  const buildProductPayload = (product: Stripe.Product) => ({
    name: product.name ?? product.id,
    stripeProductId: product.id,
    description: product.description ?? '',
    imageUrl: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '',
    taxCode: product.tax_code ?? 'txcd_10000000',
    active: product.active ?? true,
    metadata: buildComponentMetadata(product.metadata),
  });

  const upsertProduct = async (product: Stripe.Product): Promise<UpsertResult> => {
    if (!product?.id) {
      return null;
    }

    const documentsApi = getDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const payload = buildProductPayload(product);
    const existing = await findProductDocument(product.id);

    if (!existing) {
      await documentsApi.create({
        data: payload,
      });

      return 'created';
    }

    await documentsApi.update({
      documentId: existing.documentId,
      data: payload,
    });

    return 'updated';
  };

  const deleteProductByStripeId = async (stripeProductId: string) => {
    const documentsApi = getDocumentsApi();

    if (!documentsApi) {
      return false;
    }

    const existing = await findProductDocument(stripeProductId);

    if (!existing) {
      return false;
    }

    await documentsApi.delete({
      documentId: existing.documentId,
    });

    return true;
  };

  const syncProductsFromStripe = async () => {
    const stripe = getStripeClient();

    let fetched = 0;
    let changed = 0;

    for await (const product of stripe.products.list({ limit: 100 })) {
      fetched += 1;

      if (!product?.id) {
        continue;
      }

      const result = await upsertProduct(product);

      if (result) {
        changed += 1;
      }
    }

    strapi.log.debug(
      `${logPrefix} Product sync finished. Processed ${fetched} Stripe products, changed ${changed}.`
    );

    return { fetched, changed };
  };

  const handleProductEvent = async (event: Stripe.Event) => {
    const payload = event.data?.object as Stripe.Product | Stripe.DeletedProduct | undefined;

    if (!payload || typeof payload.id !== 'string') {
      strapi.log.warn(`${logPrefix} Ignoring ${event.type} event without a product payload.`);
      return;
    }

    if (PRODUCT_DELETE_EVENT_TYPES.has(event.type)) {
      await deleteProductByStripeId(payload.id);
      return;
    }

    await upsertProduct(payload as Stripe.Product);
  };

  const handleWebhookEvent = async (event: Stripe.Event) => {
    if (PRODUCT_EVENT_TYPES.has(event.type) || PRODUCT_DELETE_EVENT_TYPES.has(event.type)) {
      await handleProductEvent(event);
      return;
    }

    strapi.log.debug(`${logPrefix} No handler registered for Stripe event "${event.type}".`);
  };

  const syncAllResources = async () => {
    const products = await syncProductsFromStripe();

    return { products };
  };

  return {
    getConfig,
    getStripeClient,
    syncAll: syncAllResources,
    syncProducts: syncProductsFromStripe,
    handleWebhookEvent,
  };
};

export default createStripeSyncService;
