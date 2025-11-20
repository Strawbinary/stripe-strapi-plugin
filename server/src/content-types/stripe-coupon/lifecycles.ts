import type { Core } from '@strapi/strapi';
import Stripe from 'stripe';
import { errors } from '@strapi/utils';

import { STRIPE_COUPON_UID } from '../../constants';
import { buildStripeMetadata, type MetadataEntry } from '../../stripe/metadata';
import { getStripeClient } from '../../stripe/client';
import { isRunningInStripeSyncContext } from '../../stripe/lifecycle-context';

type StripeCouponLifecycleData = {
  documentId?: string | null;
  name?: string | null;
  duration?: Stripe.Coupon.Duration | null;
  durationInMonths?: number | null;
  amountOff?: number | null;
  percentOff?: number | string | null;
  currency?: string | null;
  redeemBy?: string | number | Date | null;
  maxRedemptions?: number | null;
  metadata?: MetadataEntry[] | null;
  stripeCouponId?: string | null;
};

type LifecycleEvent = {
  params?: {
    data?: StripeCouponLifecycleData;
  };
  state?: {
    entry?: StripeCouponLifecycleData;
  };
  result?: StripeCouponLifecycleData;
};

type StripeCouponDocumentsApi = ReturnType<Core.Strapi['documents']>;

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const hasOwnProperty = <T extends object>(obj: T, key: keyof T) => {
  return Object.prototype.hasOwnProperty.call(obj, key);
};

const normalizeCurrency = (currency: string | null | undefined) => {
  return currency?.trim().toLowerCase() ?? undefined;
};

const parseInteger = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const parseFloatValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const parseRedeemBy = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Math.trunc(value.getTime() / 1000);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const timestamp = Date.parse(value);

    if (!Number.isNaN(timestamp)) {
      return Math.trunc(timestamp / 1000);
    }
  }

  return undefined;
};

const getCouponDocumentsApi = (): StripeCouponDocumentsApi | null => {
  const documentsApi = strapi.documents;

  if (typeof documentsApi !== 'function') {
    strapi.log.error(
      '[stripe-strapi-plugin] Document service API is unavailable. Skipping Stripe coupon sync.'
    );
    return null;
  }

  return documentsApi(STRIPE_COUPON_UID);
};

const resolveCouponProductStripeIds = async (
  documentId: string | null | undefined
): Promise<string[]> => {
  if (!documentId) {
    return [];
  }

  const documentsApi = getCouponDocumentsApi();

  if (!documentsApi) {
    return [];
  }

  try {
    const coupon = await documentsApi.findOne({
      documentId,
      populate: {
        appliesToProducts: {
          fields: ['stripeProductId'],
        },
      },
    });

    const relations = coupon?.appliesToProducts;

    if (!Array.isArray(relations)) {
      return [];
    }

    return relations.reduce<string[]>((acc, product) => {
      if (!product || typeof product !== 'object') {
        return acc;
      }

      const stripeProductId = (product as { stripeProductId?: string | null }).stripeProductId;

      if (typeof stripeProductId === 'string' && stripeProductId.trim().length > 0) {
        acc.push(stripeProductId.trim());
      }

      return acc;
    }, []);
  } catch (error) {
    strapi.log.error(
      '[stripe-strapi-plugin] Failed to resolve Stripe products for coupon appliesTo relation.',
      error
    );
    return [];
  }
};

const buildCouponAppliesToPayload = (
  stripeProductIds: string[]
): Stripe.CouponCreateParams.AppliesTo | undefined => {
  if (!Array.isArray(stripeProductIds) || stripeProductIds.length === 0) {
    return undefined;
  }

  return { products: stripeProductIds };
};

const buildCouponCreatePayload = (
  data: StripeCouponLifecycleData,
  appliesToProductIds: string[]
): Stripe.CouponCreateParams => {
  const duration = data.duration ?? undefined;

  if (!duration) {
    throw new errors.ValidationError('Stripe coupon duration is required.');
  }

  const metadata = buildStripeMetadata(data.metadata ?? []);

  const payload: Stripe.CouponCreateParams = {
    name: data.name ?? undefined,
    duration,
    duration_in_months: parseInteger(data.durationInMonths),
    amount_off: parseInteger(data.amountOff),
    percent_off: parseFloatValue(data.percentOff),
    currency: normalizeCurrency(data.currency),
    redeem_by: parseRedeemBy(data.redeemBy),
    max_redemptions: parseInteger(data.maxRedemptions),
    metadata,
    applies_to: buildCouponAppliesToPayload(appliesToProductIds),
  };

  if (!payload.metadata) {
    delete payload.metadata;
  }

  if (!payload.applies_to) {
    delete payload.applies_to;
  }

  if (!payload.currency) {
    delete payload.currency;
  }

  if (!payload.redeem_by) {
    delete payload.redeem_by;
  }

  if (!payload.duration_in_months) {
    delete payload.duration_in_months;
  }

  if (!payload.amount_off) {
    delete payload.amount_off;
  }

  if (!payload.percent_off) {
    delete payload.percent_off;
  }

  if (!payload.max_redemptions) {
    delete payload.max_redemptions;
  }

  return payload;
};

const buildCouponUpdatePayload = (data: StripeCouponLifecycleData): Stripe.CouponUpdateParams => {
  const payload: Stripe.CouponUpdateParams = {};

  if (hasOwnProperty(data, 'name')) {
    payload.name = data.name ?? undefined;
  }

  if (hasOwnProperty(data, 'metadata')) {
    payload.metadata = buildStripeMetadata(data.metadata ?? []) ?? {};
  }

  return payload;
};

const resolveStripeCouponIdForEvent = (event: LifecycleEvent) => {
  if (isNonEmptyString(event.params?.data?.stripeCouponId)) {
    return event.params?.data?.stripeCouponId ?? null;
  }

  if (isNonEmptyString(event.state?.entry?.stripeCouponId)) {
    return event.state?.entry?.stripeCouponId ?? null;
  }

  if (isNonEmptyString(event.result?.stripeCouponId)) {
    return event.result?.stripeCouponId ?? null;
  }

  return null;
};

const shouldSkipStripeSync = () => {
  return isRunningInStripeSyncContext();
};

const createStripeCoupon = async (event: LifecycleEvent) => {
  const data = event.result;

  if (!data?.documentId) {
    return;
  }

  const appliesToProductIds = await resolveCouponProductStripeIds(data.documentId);
  const payload = buildCouponCreatePayload(data, appliesToProductIds);

  try {
    const stripe = getStripeClient();
    const coupon = await stripe.coupons.create(payload);

    if (!coupon?.id) {
      throw new Error('Stripe did not return a coupon ID.');
    }

    const documentsApi = getCouponDocumentsApi();

    if (documentsApi) {
      await documentsApi.update({
        documentId: data.documentId,
        fields: ['stripeCouponId'],
        data: {
          stripeCouponId: coupon.id,
        },
      });
    }
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to create Stripe coupon.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to create Stripe coupon: ${reason}`);
  }
};

const updateStripeCoupon = async (
  stripeCouponId: string,
  data: StripeCouponLifecycleData
): Promise<void> => {
  const payload = buildCouponUpdatePayload(data);

  if (Object.keys(payload).length === 0) {
    return;
  }

  try {
    const stripe = getStripeClient();
    await stripe.coupons.update(stripeCouponId, payload);
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to update Stripe coupon.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to update Stripe coupon: ${reason}`);
  }
};

const deleteStripeCoupon = async (stripeCouponId: string): Promise<void> => {
  try {
    const stripe = getStripeClient();
    await stripe.coupons.del(stripeCouponId);
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to delete Stripe coupon.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to delete Stripe coupon: ${reason}`);
  }
};

export default {
  async afterCreate(event: LifecycleEvent) {
    const data = event.params?.data;

    if (!data || data.stripeCouponId) {
      return;
    }

    await createStripeCoupon(event);
  },

  async beforeUpdate(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const data = event.params?.data;

    if (!data) {
      return;
    }

    const stripeCouponId = resolveStripeCouponIdForEvent(event);

    if (!stripeCouponId) {
      return;
    }

    await updateStripeCoupon(stripeCouponId, data);
  },

  async afterDelete(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const stripeCouponId = resolveStripeCouponIdForEvent(event);

    if (!stripeCouponId) {
      return;
    }

    await deleteStripeCoupon(stripeCouponId);
  },
};
