import type { Core } from '@strapi/strapi';
import Stripe from 'stripe';
import { errors } from '@strapi/utils';

import { STRIPE_PROMOTION_CODE_UID } from '../../constants';
import { buildStripeMetadata, type MetadataEntry } from '../../stripe/metadata';
import { getStripeClient } from '../../stripe/client';
import { isRunningInStripeSyncContext } from '../../stripe/lifecycle-context';

type PromotionCodeRestrictionsComponent = {
  firstTimeTransaction?: boolean | null;
  minimumAmount?: number | null;
  minimumAmountCurrency?: string | null;
};

type StripePromotionCodeLifecycleData = {
  documentId?: string | null;
  stripePromotionCodeId?: string | null;
  code?: string | null;
  active?: boolean | null;
  customer?: string | null;
  expiresAt?: string | number | Date | null;
  livemode?: boolean | null;
  maxRedemptions?: number | null;
  restrictions?: PromotionCodeRestrictionsComponent | null;
  metadata?: MetadataEntry[] | null;
};

type LifecycleEvent = {
  params?: {
    data?: StripePromotionCodeLifecycleData;
  };
  state?: {
    entry?: StripePromotionCodeLifecycleData;
  };
  result?: StripePromotionCodeLifecycleData;
};

type StripePromotionCodeDocumentsApi = ReturnType<Core.Strapi['documents']>;

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

const parseTimestamp = (value: unknown): number | undefined => {
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

const getPromotionCodeDocumentsApi = (): StripePromotionCodeDocumentsApi | null => {
  const documentsApi = strapi.documents;

  if (typeof documentsApi !== 'function') {
    strapi.log.error(
      '[stripe-strapi-plugin] Document service API is unavailable. Skipping Stripe promotion code sync.'
    );
    return null;
  }

  return documentsApi(STRIPE_PROMOTION_CODE_UID);
};

const resolveStripeCouponIdForEvent = async (event: LifecycleEvent) => {
  const documentId = event.result?.documentId;

  if (!documentId) {
    return null;
  }

  const documentsApi = getPromotionCodeDocumentsApi();

  if (!documentsApi) {
    return null;
  }

  try {
    const promotionCode = await documentsApi.findOne({
      documentId,
      populate: {
        stripeCoupon: {
          fields: ['stripeCouponId'],
        },
      },
    });

    const relation = promotionCode?.stripeCoupon;

    if (relation && typeof relation === 'object') {
      const stripeCouponId = (relation as { stripeCouponId?: string | null }).stripeCouponId;

      if (typeof stripeCouponId === 'string' && stripeCouponId.trim().length > 0) {
        return stripeCouponId.trim();
      }
    }
  } catch (error) {
    strapi.log.error(
      '[stripe-strapi-plugin] Failed to resolve related Stripe coupon for promotion code creation.',
      error
    );
  }

  return null;
};

const buildRestrictionsPayload = (
  restrictions: PromotionCodeRestrictionsComponent | null | undefined
): Stripe.PromotionCodeCreateParams.Restrictions | undefined => {
  if (!restrictions) {
    return undefined;
  }

  const payload: Stripe.PromotionCodeCreateParams.Restrictions = {};

  if (typeof restrictions.firstTimeTransaction === 'boolean') {
    payload.first_time_transaction = restrictions.firstTimeTransaction;
  }

  const minimumAmount = parseInteger(restrictions.minimumAmount);

  if (typeof minimumAmount === 'number') {
    payload.minimum_amount = minimumAmount;
  }

  const minimumAmountCurrency = normalizeCurrency(restrictions.minimumAmountCurrency);

  if (minimumAmountCurrency) {
    payload.minimum_amount_currency = minimumAmountCurrency;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
};

const buildPromotionCodeCreatePayload = (
  data: StripePromotionCodeLifecycleData,
  stripeCouponId: string
): Stripe.PromotionCodeCreateParams => {
  if (!isNonEmptyString(data.code)) {
    throw new errors.ValidationError('Stripe promotion code requires a code value.');
  }

  const metadata = buildStripeMetadata(data.metadata ?? []);

  const payload: Stripe.PromotionCodeCreateParams = {
    promotion: {
      type: 'coupon',
      coupon: stripeCouponId,
    },
    code: data.code,
    active: data.active ?? true,
    customer: data.customer ?? undefined,
    expires_at: parseTimestamp(data.expiresAt),
    max_redemptions: parseInteger(data.maxRedemptions),
    metadata,
    restrictions: buildRestrictionsPayload(data.restrictions),
  };

  if (!payload.metadata) {
    delete payload.metadata;
  }

  if (!payload.restrictions) {
    delete payload.restrictions;
  }

  if (!payload.expires_at) {
    delete payload.expires_at;
  }

  if (!payload.max_redemptions) {
    delete payload.max_redemptions;
  }

  if (!payload.customer) {
    delete payload.customer;
  }

  return payload;
};

const buildPromotionCodeUpdatePayload = (
  data: StripePromotionCodeLifecycleData
): Stripe.PromotionCodeUpdateParams => {
  const payload: Stripe.PromotionCodeUpdateParams = {};

  if (hasOwnProperty(data, 'active')) {
    payload.active = data.active ?? undefined;
  }

  if (hasOwnProperty(data, 'metadata')) {
    payload.metadata = buildStripeMetadata(data.metadata ?? []) ?? {};
  }

  return payload;
};

const resolveStripePromotionCodeIdForEvent = (event: LifecycleEvent) => {
  if (isNonEmptyString(event.params?.data?.stripePromotionCodeId)) {
    return event.params?.data?.stripePromotionCodeId ?? null;
  }

  if (isNonEmptyString(event.state?.entry?.stripePromotionCodeId)) {
    return event.state?.entry?.stripePromotionCodeId ?? null;
  }

  if (isNonEmptyString(event.result?.stripePromotionCodeId)) {
    return event.result?.stripePromotionCodeId ?? null;
  }

  return null;
};

const shouldSkipStripeSync = () => {
  return isRunningInStripeSyncContext();
};

const createStripePromotionCode = async (event: LifecycleEvent) => {
  const data = event.result;

  if (!data?.documentId) {
    return;
  }

  const stripeCouponId = await resolveStripeCouponIdForEvent(event);

  if (!stripeCouponId) {
    throw new errors.ValidationError(
      'Unable to resolve a Stripe coupon ID for the selected stripeCoupon relation.'
    );
  }

  const payload = buildPromotionCodeCreatePayload(data, stripeCouponId);

  try {
    const stripe = getStripeClient();
    const promotionCode = await stripe.promotionCodes.create(payload);

    if (!promotionCode?.id) {
      throw new Error('Stripe did not return a promotion code ID.');
    }

    const documentsApi = getPromotionCodeDocumentsApi();

    if (documentsApi) {
      await documentsApi.update({
        documentId: data.documentId,
        fields: ['stripePromotionCodeId'],
        data: {
          stripePromotionCodeId: promotionCode.id,
        },
      });
    }
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to create Stripe promotion code.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to create Stripe promotion code: ${reason}`);
  }
};

const updateStripePromotionCode = async (
  stripePromotionCodeId: string,
  data: StripePromotionCodeLifecycleData
): Promise<void> => {
  const payload = buildPromotionCodeUpdatePayload(data);

  if (Object.keys(payload).length === 0) {
    return;
  }

  try {
    const stripe = getStripeClient();
    await stripe.promotionCodes.update(stripePromotionCodeId, payload);
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to update Stripe promotion code.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to update Stripe promotion code: ${reason}`);
  }
};

const deactivateStripePromotionCode = async (stripePromotionCodeId: string): Promise<void> => {
  try {
    const stripe = getStripeClient();

    await stripe.promotionCodes.update(stripePromotionCodeId, { active: false });
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to deactivate Stripe promotion code.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to deactivate Stripe promotion code: ${reason}`);
  }
};

export default {
  async afterCreate(event: LifecycleEvent) {
    const data = event.params?.data;

    if (!data || data.stripePromotionCodeId) {
      return;
    }

    await createStripePromotionCode(event);
  },

  async beforeUpdate(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const data = event.params?.data;

    if (!data) {
      return;
    }

    const stripePromotionCodeId = resolveStripePromotionCodeIdForEvent(event);

    if (!stripePromotionCodeId) {
      return;
    }

    await updateStripePromotionCode(stripePromotionCodeId, data);
  },

  async afterDelete(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const stripePromotionCodeId = resolveStripePromotionCodeIdForEvent(event);

    if (!stripePromotionCodeId) {
      return;
    }

    await deactivateStripePromotionCode(stripePromotionCodeId);
  },
};
