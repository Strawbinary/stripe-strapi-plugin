import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import Stripe from 'stripe';

import { STRIPE_PRICE_UID, STRIPE_PRODUCT_UID } from '../constants';
import { STRIPE_API_VERSION } from '../stripe/constants';
import { resolvePluginConfig } from '../stripe/config';
import { buildComponentMetadata } from '../stripe/metadata';
import { runWithStripeSyncContext } from '../stripe/lifecycle-context';

type StripeProductDocumentsApi = ReturnType<Core.Strapi['documents']>;
type StripePriceDocumentsApi = ReturnType<Core.Strapi['documents']>;

type PriceRecurringComponent = {
  interval?: Stripe.Price.Recurring.Interval | null;
  interval_count?: number | null;
  meter?: string | null;
  usage_type?: Stripe.Price.Recurring.UsageType | null;
};

type PriceTierComponent = {
  flatAmount?: number | null;
  flatAmountDecimal?: string | null;
  unitAmount?: number | null;
  unitAmountDecimal?: string | null;
  upTo?: number | null;
};

type PriceCustomUnitAmountComponent = {
  maximum?: number | null;
  minimum?: number | null;
  preset?: number | null;
};

type UpsertResult = 'created' | 'updated' | null;

const PRODUCT_EVENT_TYPES = new Set(['product.created', 'product.updated']);
const PRODUCT_DELETE_EVENT_TYPES = new Set(['product.deleted']);
const PRICE_EVENT_TYPES = new Set(['price.created', 'price.updated']);
const PRICE_DELETE_EVENT_TYPES = new Set(['price.deleted']);

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

  const getProductDocumentsApi = (): StripeProductDocumentsApi | null => {
    const documentsApi = strapi.documents;

    if (typeof documentsApi !== 'function') {
      strapi.log.error(`${logPrefix} Document service API is unavailable. Skipping Stripe sync.`);
      return null;
    }

    return documentsApi(STRIPE_PRODUCT_UID);
  };

  const findProductDocument = async (stripeProductId: string) => {
    const documentsApi = getProductDocumentsApi();

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

  const ensureProductDocument = async (
    productRef: Stripe.Price['product']
  ): Promise<{ documentId: string } | null> => {
    const stripeProductId =
      typeof productRef === 'string'
        ? productRef
        : typeof productRef?.id === 'string'
          ? productRef.id
          : null;

    const productObject =
      typeof productRef === 'object' && productRef !== null
        ? (productRef as Stripe.Product | Stripe.DeletedProduct)
        : null;
    const productIsDeleted =
      productObject != null && 'deleted' in productObject && Boolean(productObject.deleted);

    if (!stripeProductId) {
      return null;
    }

    const existing = await findProductDocument(stripeProductId);

    if (existing) {
      if (productObject && !productIsDeleted) {
        await upsertProduct(productObject as Stripe.Product);
      }

      return existing;
    }

    if (productObject && !productIsDeleted) {
      await upsertProduct(productObject as Stripe.Product);
      return findProductDocument(stripeProductId);
    }

    try {
      const stripe = getStripeClient();
      const product = await stripe.products.retrieve(stripeProductId);

      if (product && !('deleted' in product && Boolean(product.deleted))) {
        await upsertProduct(product as Stripe.Product);
        return findProductDocument(stripeProductId);
      }
    } catch (error) {
      strapi.log.error(
        `${logPrefix} Failed to resolve Stripe product "${stripeProductId}" required for price sync.`,
        error
      );
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

    const documentsApi = getProductDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const payload = buildProductPayload(product);
    const existing = await findProductDocument(product.id);

    if (!existing) {
      await runWithStripeSyncContext(() =>
        documentsApi.create({
          data: payload,
        })
      );

      return 'created';
    }

    await runWithStripeSyncContext(() =>
      documentsApi.update({
        documentId: existing.documentId,
        data: payload,
      })
    );

    return 'updated';
  };

  const deleteProductByStripeId = async (stripeProductId: string) => {
    const documentsApi = getProductDocumentsApi();

    if (!documentsApi) {
      return false;
    }

    const existing = await findProductDocument(stripeProductId);

    if (!existing) {
      return false;
    }

    await runWithStripeSyncContext(() =>
      documentsApi.delete({
        documentId: existing.documentId,
      })
    );

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

  const getPriceDocumentsApi = (): StripePriceDocumentsApi | null => {
    const documentsApi = strapi.documents;

    if (typeof documentsApi !== 'function') {
      strapi.log.error(`${logPrefix} Document service API is unavailable. Skipping Stripe price sync.`);
      return null;
    }

    return documentsApi(STRIPE_PRICE_UID);
  };

  const findPriceDocument = async (stripePriceId: string) => {
    const documentsApi = getPriceDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const existing = await documentsApi.findFirst({
      fields: ['documentId'],
      filters: {
        stripePriceId: {
          $eq: stripePriceId,
        },
      },
    });

    if (existing?.documentId) {
      return { documentId: existing.documentId };
    }

    return null;
  };

  const buildRecurringComponent = (
    recurring: Stripe.Price.Recurring | null
  ): PriceRecurringComponent | null => {
    if (!recurring) {
      return null;
    }

    return {
      interval: recurring.interval ?? null,
      interval_count: recurring.interval_count ?? null,
      usage_type: recurring.usage_type ?? null,
      meter: recurring.meter ?? null,
    };
  };

  const buildCustomUnitAmountComponent = (
    customUnitAmount: Stripe.Price.CustomUnitAmount | null
  ): PriceCustomUnitAmountComponent | null => {
    if (!customUnitAmount) {
      return null;
    }

    if (
      customUnitAmount.maximum == null &&
      customUnitAmount.minimum == null &&
      customUnitAmount.preset == null
    ) {
      return null;
    }

    return {
      maximum: customUnitAmount.maximum ?? null,
      minimum: customUnitAmount.minimum ?? null,
      preset: customUnitAmount.preset ?? null,
    };
  };

  const buildTierComponents = (tiers: Stripe.Price.Tier[] | undefined): PriceTierComponent[] => {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      return [];
    }

    return tiers.reduce<PriceTierComponent[]>((acc, tier) => {
      if (!tier) {
        return acc;
      }

      acc.push({
        flatAmount: tier.flat_amount ?? null,
        flatAmountDecimal: tier.flat_amount_decimal ?? null,
        unitAmount: tier.unit_amount ?? null,
        unitAmountDecimal: tier.unit_amount_decimal ?? null,
        upTo: typeof tier.up_to === 'number' ? tier.up_to : null,
      });

      return acc;
    }, []);
  };

  const buildPricePayload = (price: Stripe.Price, productDocumentId: string) => ({
    stripePriceId: price.id,
    stripeProduct: productDocumentId,
    active: price.active,
    billingScheme: price.billing_scheme,
    created: price.created,
    currency: price.currency ? price.currency.toUpperCase() : price.currency,
    customUnitAmount: buildCustomUnitAmountComponent(price.custom_unit_amount),
    livemode: price.livemode,
    lookupKey: price.lookup_key ?? null,
    metadata: buildComponentMetadata(price.metadata),
    nickname: price.nickname ?? null,
    recurring: buildRecurringComponent(price.recurring),
    taxBehavior: price.tax_behavior,
    tiers: buildTierComponents(price.tiers),
    tiersMode: price.tiers_mode,
    type: price.type,
    unitAmount: price.unit_amount ?? undefined,
    unitAmountDecimal: price.unit_amount_decimal ?? undefined,
  });

  const upsertPrice = async (price: Stripe.Price): Promise<UpsertResult> => {
    if (!price?.id) {
      return null;
    }

    const documentsApi = getPriceDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const relatedProduct = await ensureProductDocument(price.product);

    if (!relatedProduct?.documentId) {
      strapi.log.warn(
        `${logPrefix} Skipping price "${price.id}" because the related product could not be resolved.`
      );
      return null;
    }

    const payload = buildPricePayload(price, relatedProduct.documentId);
    const existing = await findPriceDocument(price.id);

    if (!existing) {
      await runWithStripeSyncContext(() =>
        documentsApi.create({
          data: payload,
        })
      );

      return 'created';
    }

    await runWithStripeSyncContext(() =>
      documentsApi.update({
        documentId: existing.documentId,
        data: payload,
      })
    );

    return 'updated';
  };

  const deletePriceByStripeId = async (stripePriceId: string) => {
    const documentsApi = getPriceDocumentsApi();

    if (!documentsApi) {
      return false;
    }

    const existing = await findPriceDocument(stripePriceId);

    if (!existing) {
      return false;
    }

    await runWithStripeSyncContext(() =>
      documentsApi.delete({
        documentId: existing.documentId,
      })
    );

    return true;
  };

  const syncPricesFromStripe = async () => {
    const stripe = getStripeClient();

    let fetched = 0;
    let changed = 0;

    for await (const price of stripe.prices.list({ limit: 100, expand: ['data.product'] })) {
      fetched += 1;

      if (!price?.id) {
        continue;
      }

      const result = await upsertPrice(price);

      if (result) {
        changed += 1;
      }
    }

    strapi.log.debug(
      `${logPrefix} Price sync finished. Processed ${fetched} Stripe prices, changed ${changed}.`
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

  const handlePriceEvent = async (event: Stripe.Event) => {
    const payload = event.data?.object as Stripe.Price | Stripe.DeletedPrice | undefined;

    if (!payload || typeof payload.id !== 'string') {
      strapi.log.warn(`${logPrefix} Ignoring ${event.type} event without a price payload.`);
      return;
    }

    if (PRICE_DELETE_EVENT_TYPES.has(event.type)) {
      await deletePriceByStripeId(payload.id);
      return;
    }

    await upsertPrice(payload as Stripe.Price);
  };

  const handleWebhookEvent = async (event: Stripe.Event) => {
    if (PRODUCT_EVENT_TYPES.has(event.type) || PRODUCT_DELETE_EVENT_TYPES.has(event.type)) {
      await handleProductEvent(event);
      return;
    }

    if (PRICE_EVENT_TYPES.has(event.type) || PRICE_DELETE_EVENT_TYPES.has(event.type)) {
      await handlePriceEvent(event);
      return;
    }

    strapi.log.debug(`${logPrefix} No handler registered for Stripe event "${event.type}".`);
  };

  const syncAllResources = async () => {
    const products = await syncProductsFromStripe();
    const prices = await syncPricesFromStripe();

    return { products, prices };
  };

  return {
    getConfig,
    getStripeClient,
    syncAll: syncAllResources,
    syncProducts: syncProductsFromStripe,
    syncPrices: syncPricesFromStripe,
    handleWebhookEvent,
  };
};

export default createStripeSyncService;
