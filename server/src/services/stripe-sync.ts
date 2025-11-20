import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import Stripe from 'stripe';

import {
  STRIPE_PRICE_UID,
  STRIPE_PRODUCT_UID,
  STRIPE_COUPON_UID,
  STRIPE_PROMOTION_CODE_UID,
} from '../constants';
import { STRIPE_API_VERSION } from '../stripe/constants';
import { resolvePluginConfig } from '../stripe/config';
import { buildComponentMetadata } from '../stripe/metadata';
import { runWithStripeSyncContext } from '../stripe/lifecycle-context';

type StripeProductDocumentsApi = ReturnType<Core.Strapi['documents']>;
type StripePriceDocumentsApi = ReturnType<Core.Strapi['documents']>;
type StripeCouponDocumentsApi = ReturnType<Core.Strapi['documents']>;
type StripePromotionCodeDocumentsApi = ReturnType<Core.Strapi['documents']>;

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

type PromotionCodeRestrictionsComponent = {
  firstTimeTransaction?: boolean | null;
  minimumAmount?: number | null;
  minimumAmountCurrency?: string | null;
};

type UpsertResult = 'created' | 'updated' | null;

const PRODUCT_EVENT_TYPES = new Set(['product.created', 'product.updated']);
const PRODUCT_DELETE_EVENT_TYPES = new Set(['product.deleted']);
const PRICE_EVENT_TYPES = new Set(['price.created', 'price.updated']);
const PRICE_DELETE_EVENT_TYPES = new Set(['price.deleted']);
const COUPON_EVENT_TYPES = new Set(['coupon.created', 'coupon.updated']);
const COUPON_DELETE_EVENT_TYPES = new Set(['coupon.deleted']);
const PROMOTION_CODE_EVENT_TYPES = new Set(['promotion_code.created', 'promotion_code.updated']);

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
    created: convertUnixTimestampToIso(price.created),
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

  const getCouponDocumentsApi = (): StripeCouponDocumentsApi | null => {
    const documentsApi = strapi.documents;

    if (typeof documentsApi !== 'function') {
      strapi.log.error(`${logPrefix} Document service API is unavailable. Skipping Stripe coupon sync.`);
      return null;
    }

    return documentsApi(STRIPE_COUPON_UID);
  };

  const findCouponDocument = async (stripeCouponId: string) => {
    const documentsApi = getCouponDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const existing = await documentsApi.findFirst({
      fields: ['documentId'],
      filters: {
        stripeCouponId: {
          $eq: stripeCouponId,
        },
      },
    });

    if (existing?.documentId) {
      return { documentId: existing.documentId };
    }

    return null;
  };

  const convertUnixTimestampToIso = (timestamp?: number | null) => {
    if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp * 1000).toISOString();
  };

  const resolveCouponApplicableProductDocumentIds = async (coupon: Stripe.Coupon) => {
    const productRefs = coupon.applies_to?.products;

    if (!Array.isArray(productRefs) || productRefs.length === 0) {
      return [];
    }

    const relatedDocuments = await Promise.all(
      productRefs.map(async (productRef) => {
        return ensureProductDocument(productRef);
      })
    );

    return relatedDocuments
      .map((entry) => entry?.documentId)
      .filter((documentId): documentId is string => typeof documentId === 'string');
  };

  const buildCouponPayload = async (coupon: Stripe.Coupon) => {
    const appliesToProducts = await resolveCouponApplicableProductDocumentIds(coupon);

    return {
      stripeCouponId: coupon.id,
      name: coupon.name ?? coupon.id,
      duration: coupon.duration ?? 'forever',
      durationInMonths: coupon.duration_in_months ?? null,
      amountOff: coupon.amount_off ?? null,
      percentOff: coupon.percent_off ?? null,
      currency: coupon.currency ? coupon.currency.toUpperCase() : coupon.currency,
      redeemBy: convertUnixTimestampToIso(coupon.redeem_by),
      maxRedemptions: coupon.max_redemptions ?? null,
      timesRedeemed: coupon.times_redeemed ?? null,
      appliesToProducts,
      livemode: coupon.livemode,
      valid: coupon.valid ?? null,
      metadata: buildComponentMetadata(coupon.metadata),
      created: convertUnixTimestampToIso(coupon.created),
    };
  };

  const upsertCoupon = async (coupon: Stripe.Coupon): Promise<UpsertResult> => {
    if (!coupon?.id) {
      return null;
    }

    const documentsApi = getCouponDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const payload = await buildCouponPayload(coupon);
    const existing = await findCouponDocument(coupon.id);

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

  const deleteCouponByStripeId = async (stripeCouponId: string) => {
    const documentsApi = getCouponDocumentsApi();

    if (!documentsApi) {
      return false;
    }

    const existing = await findCouponDocument(stripeCouponId);

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

  const syncCouponsFromStripe = async () => {
    const stripe = getStripeClient();

    let fetched = 0;
    let changed = 0;

    for await (const coupon of stripe.coupons.list({ limit: 100 })) {
      fetched += 1;

      if (!coupon?.id) {
        continue;
      }

      const result = await upsertCoupon(coupon);

      if (result) {
        changed += 1;
      }
    }

    strapi.log.debug(
      `${logPrefix} Coupon sync finished. Processed ${fetched} Stripe coupons, changed ${changed}.`
    );

    return { fetched, changed };
  };

  const getPromotionCodeDocumentsApi = (): StripePromotionCodeDocumentsApi | null => {
    const documentsApi = strapi.documents;

    if (typeof documentsApi !== 'function') {
      strapi.log.error(
        `${logPrefix} Document service API is unavailable. Skipping Stripe promotion code sync.`
      );
      return null;
    }

    return documentsApi(STRIPE_PROMOTION_CODE_UID);
  };

  const findPromotionCodeDocument = async (stripePromotionCodeId: string) => {
    const documentsApi = getPromotionCodeDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const existing = await documentsApi.findFirst({
      fields: ['documentId'],
      filters: {
        stripePromotionCodeId: {
          $eq: stripePromotionCodeId,
        },
      },
    });

    if (existing?.documentId) {
      return { documentId: existing.documentId };
    }

    return null;
  };

  const buildPromotionCodeRestrictionsComponent = (
    restrictions: Stripe.PromotionCode.Restrictions | null
  ): PromotionCodeRestrictionsComponent | null => {
    if (!restrictions) {
      return null;
    }

    if (
      restrictions.first_time_transaction == null &&
      restrictions.minimum_amount == null &&
      !restrictions.minimum_amount_currency
    ) {
      return null;
    }

    return {
      firstTimeTransaction: restrictions.first_time_transaction ?? null,
      minimumAmount: restrictions.minimum_amount ?? null,
      minimumAmountCurrency: restrictions.minimum_amount_currency
        ? restrictions.minimum_amount_currency.toUpperCase()
        : null,
    };
  };

  const buildPromotionCodePayload = (
    promotionCode: Stripe.PromotionCode,
    couponDocumentId: string
  ) => ({
    stripePromotionCodeId: promotionCode.id,
    code: promotionCode.code ?? null,
    active: promotionCode.active,
    customer:
      typeof promotionCode.customer === 'string'
        ? promotionCode.customer
        : promotionCode.customer?.id ?? null,
    expiresAt: convertUnixTimestampToIso(promotionCode.expires_at),
    livemode: promotionCode.livemode,
    maxRedemptions: promotionCode.max_redemptions ?? null,
    timesRedeemed: promotionCode.times_redeemed ?? null,
    restrictions: buildPromotionCodeRestrictionsComponent(promotionCode.restrictions),
    metadata: buildComponentMetadata(promotionCode.metadata),
    created: convertUnixTimestampToIso(promotionCode.created),
    stripeCoupon: couponDocumentId,
  });

  const ensureCouponDocument = async (
    promotion: Stripe.PromotionCode['promotion'] | null
  ): Promise<{ documentId: string } | null> => {
    if (!promotion) {
      return null;
    }

    const couponRef = promotion.coupon;

    const stripeCouponId =
      typeof couponRef === 'string'
        ? couponRef
        : typeof couponRef?.id === 'string'
          ? couponRef.id
          : null;

    type MaybeDeletedCoupon = Stripe.Coupon & { deleted?: boolean };
    const couponObject =
      typeof couponRef === 'object' && couponRef !== null
        ? (couponRef as MaybeDeletedCoupon)
        : null;
    const couponIsDeleted = couponObject != null && Boolean(couponObject.deleted);

    if (!stripeCouponId) {
      return null;
    }

    const existing = await findCouponDocument(stripeCouponId);

    if (existing) {
      if (couponObject && !couponIsDeleted) {
        await upsertCoupon(couponObject as Stripe.Coupon);
      }

      return existing;
    }

    if (couponObject && !couponIsDeleted) {
      await upsertCoupon(couponObject as Stripe.Coupon);
      return findCouponDocument(stripeCouponId);
    }

    try {
      const stripe = getStripeClient();
      const coupon = await stripe.coupons.retrieve(stripeCouponId);

      if (coupon && !('deleted' in coupon && Boolean(coupon.deleted))) {
        await upsertCoupon(coupon as Stripe.Coupon);
        return findCouponDocument(stripeCouponId);
      }
    } catch (error) {
      strapi.log.error(
        `${logPrefix} Failed to resolve Stripe coupon "${stripeCouponId}" required for promotion code sync.`,
        error
      );
    }

    return null;
  };

  const upsertPromotionCode = async (promotionCode: Stripe.PromotionCode): Promise<UpsertResult> => {
    if (!promotionCode?.id) {
      return null;
    }

    const documentsApi = getPromotionCodeDocumentsApi();

    if (!documentsApi) {
      return null;
    }

    const relatedCoupon = await ensureCouponDocument(promotionCode.promotion);

    if (!relatedCoupon?.documentId) {
      strapi.log.warn(
        `${logPrefix} Skipping promotion code "${promotionCode.id}" because the related coupon could not be resolved.`
      );
      return null;
    }

    const payload = buildPromotionCodePayload(promotionCode, relatedCoupon.documentId);
    const existing = await findPromotionCodeDocument(promotionCode.id);

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

  const syncPromotionCodesFromStripe = async () => {
    const stripe = getStripeClient();

    let fetched = 0;
    let changed = 0;

    for await (const promotionCode of stripe.promotionCodes.list({
      limit: 100,
      expand: ['data.promotion.coupon'],
    })) {
      fetched += 1;

      if (!promotionCode?.id) {
        continue;
      }

      const result = await upsertPromotionCode(promotionCode);

      if (result) {
        changed += 1;
      }
    }

    strapi.log.debug(
      `${logPrefix} Promotion code sync finished. Processed ${fetched} Stripe promotion codes, changed ${changed}.`
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

  const handleCouponEvent = async (event: Stripe.Event) => {
    const payload = event.data?.object as Stripe.Coupon | undefined;

    if (!payload || typeof payload.id !== 'string') {
      strapi.log.warn(`${logPrefix} Ignoring ${event.type} event without a coupon payload.`);
      return;
    }

    if (COUPON_DELETE_EVENT_TYPES.has(event.type)) {
      await deleteCouponByStripeId(payload.id);
      return;
    }

    await upsertCoupon(payload as Stripe.Coupon);
  };

  const handlePromotionCodeEvent = async (event: Stripe.Event) => {
    const payload = event.data?.object as Stripe.PromotionCode | undefined;

    if (!payload || typeof payload.id !== 'string') {
      strapi.log.warn(`${logPrefix} Ignoring ${event.type} event without a promotion code payload.`);
      return;
    }

    await upsertPromotionCode(payload as Stripe.PromotionCode);
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

    if (COUPON_EVENT_TYPES.has(event.type) || COUPON_DELETE_EVENT_TYPES.has(event.type)) {
      await handleCouponEvent(event);
      return;
    }

    if (PROMOTION_CODE_EVENT_TYPES.has(event.type)) {
      await handlePromotionCodeEvent(event);
      return;
    }

    strapi.log.debug(`${logPrefix} No handler registered for Stripe event "${event.type}".`);
  };

  const syncAllResources = async () => {
    const products = await syncProductsFromStripe();
    const prices = await syncPricesFromStripe();
     const coupons = await syncCouponsFromStripe();
     const promotionCodes = await syncPromotionCodesFromStripe();

    return { products, prices, coupons, promotionCodes };
  };

  return {
    getConfig,
    getStripeClient,
    syncAll: syncAllResources,
    syncProducts: syncProductsFromStripe,
    syncPrices: syncPricesFromStripe,
    syncCoupons: syncCouponsFromStripe,
    syncPromotionCodes: syncPromotionCodesFromStripe,
    handleWebhookEvent,
  };
};

export default createStripeSyncService;
