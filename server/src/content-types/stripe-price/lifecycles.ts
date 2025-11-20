import type { Core } from '@strapi/strapi';
import Stripe from 'stripe';
import { errors } from '@strapi/utils';

import { buildStripeMetadata, type MetadataEntry } from '../../stripe/metadata';
import { getStripeClient } from '../../stripe/client';
import { isRunningInStripeSyncContext } from '../../stripe/lifecycle-context';
import { STRIPE_PRICE_UID, STRIPE_PRODUCT_UID } from '../../constants';

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

type RelationInput =
  | {
      documentId?: string | number | null;
      id?: string | number | null;
      connect?: RelationInput[];
      set?: RelationInput[];
    }
  | RelationInput[]
  | null
  | undefined;

type StripePriceLifecycleData = {
  documentId?: string | null;
  stripePriceId?: string | null;
  stripeProduct?: RelationInput;
  active?: boolean | null;
  billingScheme?: Stripe.Price.BillingScheme | null;
  created?: number | null;
  currency?: string | null;
  customUnitAmount?: PriceCustomUnitAmountComponent | null;
  livemode?: boolean | null;
  lookupKey?: string | null;
  metadata?: MetadataEntry[] | null;
  nickname?: string | null;
  recurring?: PriceRecurringComponent | null;
  taxBehavior?: Stripe.Price.TaxBehavior | null;
  tiers?: PriceTierComponent[] | null;
  tiersMode?: Stripe.Price.TiersMode | null;
  type?: Stripe.Price.Type | null;
  unitAmount?: number | null;
  unitAmountDecimal?: string | null;
};

type LifecycleEvent = {
  params?: {
    data?: StripePriceLifecycleData;
  };
  state?: {
    entry?: StripePriceLifecycleData;
  };
  result?: StripePriceLifecycleData;
};

type StripePriceDocumentsApi = ReturnType<Core.Strapi['documents']>;

const getPriceDocumentsApi = (): StripePriceDocumentsApi | null => {
  const documentsApi = strapi.documents;

  if (typeof documentsApi !== 'function') {
    strapi.log.error(
      '[stripe-strapi-plugin] Document service API is unavailable. Skipping Stripe sync.'
    );
    return null;
  }

  return documentsApi(STRIPE_PRICE_UID);
};

const resolveStripeProductIdForEvent = async (event: LifecycleEvent) => {
  const priceDocumentId = event.result.documentId;

  if (priceDocumentId) {
    try {
      const stripePrice = await strapi.documents(STRIPE_PRICE_UID).findOne({
        documentId: priceDocumentId,
        populate: '*',
      });

      return stripePrice.stripeProduct.stripeProductId;
    } catch (e) {
      throw new errors.ValidationError('Stripe Price object not found in strapi', e);
    }
  }

  return null;
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const resolveStripePriceIdForEvent = (event: LifecycleEvent) => {
  if (isNonEmptyString(event.params?.data?.stripePriceId)) {
    return event.params?.data?.stripePriceId ?? null;
  }

  if (isNonEmptyString(event.state?.entry?.stripePriceId)) {
    return event.state?.entry?.stripePriceId ?? null;
  }

  if (isNonEmptyString(event.result?.stripePriceId)) {
    return event.result?.stripePriceId ?? null;
  }

  return null;
};

const buildStripeRecurringPayload = (
  recurring: PriceRecurringComponent | null | undefined
): Stripe.PriceCreateParams.Recurring | undefined => {
  if (!recurring || !recurring.interval) {
    return undefined;
  }

  const payload: Stripe.PriceCreateParams.Recurring = {
    interval: recurring.interval,
  };

  if (typeof recurring.interval_count === 'number') {
    payload.interval_count = recurring.interval_count;
  }

  if (recurring.usage_type) {
    payload.usage_type = recurring.usage_type;
  }

  if (recurring.meter) {
    payload.meter = recurring.meter;
  }

  return payload;
};

const buildStripeCustomUnitAmountPayload = (
  customUnitAmount: PriceCustomUnitAmountComponent | null | undefined
): Stripe.PriceCreateParams.CustomUnitAmount | undefined => {
  if (!customUnitAmount) {
    return undefined;
  }

  const payload: Stripe.PriceCreateParams.CustomUnitAmount = {
    enabled: true,
  };

  if (typeof customUnitAmount.minimum === 'number') {
    payload.minimum = customUnitAmount.minimum;
  }

  if (typeof customUnitAmount.maximum === 'number') {
    payload.maximum = customUnitAmount.maximum;
  }

  if (typeof customUnitAmount.preset === 'number') {
    payload.preset = customUnitAmount.preset;
  }

  return payload;
};

const buildStripeTiersPayload = (tiers: PriceTierComponent[] | null | undefined) => {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return undefined;
  }

  const payload = tiers.reduce<Stripe.PriceCreateParams.Tier[]>((acc, tier) => {
    if (!tier) {
      return acc;
    }

    const tierPayload: Stripe.PriceCreateParams.Tier = {
      up_to: typeof tier.upTo === 'number' ? tier.upTo : 'inf',
    };

    if (typeof tier.flatAmount === 'number') {
      tierPayload.flat_amount = tier.flatAmount;
    }

    if (isNonEmptyString(tier.flatAmountDecimal)) {
      tierPayload.flat_amount_decimal = tier.flatAmountDecimal;
    }

    if (typeof tier.unitAmount === 'number') {
      tierPayload.unit_amount = tier.unitAmount;
    }

    if (isNonEmptyString(tier.unitAmountDecimal)) {
      tierPayload.unit_amount_decimal = tier.unitAmountDecimal;
    }

    acc.push(tierPayload);

    return acc;
  }, []);

  return payload.length > 0 ? payload : undefined;
};

const normalizeCurrency = (currency: string | null | undefined) => {
  return currency?.trim().toLowerCase() ?? undefined;
};

const buildPriceCreatePayload = (
  data: StripePriceLifecycleData,
  stripeProductId: string
): Stripe.PriceCreateParams => {
  const currency = normalizeCurrency(data.currency);

  if (!currency) {
    throw new errors.ValidationError(
      'Stripe price currency is required to create a price on Stripe.'
    );
  }

  const metadata = buildStripeMetadata(data.metadata ?? []);

  const payload: Stripe.PriceCreateParams = {
    product: stripeProductId,
    currency,
    active: data.active ?? true,
    billing_scheme: data.billingScheme ?? undefined,
    custom_unit_amount: buildStripeCustomUnitAmountPayload(data.customUnitAmount),
    lookup_key: data.lookupKey ?? undefined,
    metadata,
    nickname: data.nickname ?? undefined,
    recurring: buildStripeRecurringPayload(data.recurring),
    tax_behavior: data.taxBehavior ?? undefined,
    tiers: buildStripeTiersPayload(data.tiers),
    tiers_mode: data.tiersMode ?? undefined,
    unit_amount: data.unitAmount ?? undefined,
    unit_amount_decimal: data.unitAmountDecimal ?? undefined,
  };

  if (!payload.metadata) {
    delete payload.metadata;
  }

  if (!payload.tiers || payload.tiers.length === 0) {
    delete payload.tiers;
    delete payload.tiers_mode;
  } else if (payload.billing_scheme !== 'tiered') {
    payload.billing_scheme = 'tiered';
  }

  return payload;
};

const buildPriceUpdatePayload = (data: StripePriceLifecycleData): Stripe.PriceUpdateParams => {
  const payload: Stripe.PriceUpdateParams = {};

  if (Object.prototype.hasOwnProperty.call(data, 'active')) {
    payload.active = data.active ?? undefined;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'metadata')) {
    payload.metadata = buildStripeMetadata(data.metadata ?? []) ?? {};
  }

  if (Object.prototype.hasOwnProperty.call(data, 'nickname')) {
    payload.nickname = data.nickname ?? undefined;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'lookupKey')) {
    payload.lookup_key = data.lookupKey ?? undefined;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'taxBehavior')) {
    payload.tax_behavior = data.taxBehavior ?? undefined;
  }

  return payload;
};

const createStripePrice = async (event: LifecycleEvent) => {
  const data = event.result;

  if (!data) {
    return;
  }

  const stripeProductId = await resolveStripeProductIdForEvent(event);

  if (!stripeProductId) {
    strapi.log.error(
      '[stripe-strapi-plugin] Unable to resolve a Stripe product ID for the selected stripeProduct relation.'
    );
    throw new errors.ValidationError(
      'Unable to resolve a Stripe product ID for the selected stripeProduct relation.'
    );
  }

  const payload = buildPriceCreatePayload(data, stripeProductId);

  try {
    const stripe = getStripeClient();
    const price = await stripe.prices.create(payload);

    if (!price?.id) {
      throw new Error('Stripe did not return a price ID.');
    }

    await getPriceDocumentsApi().update({
      documentId: data.documentId,
      fields: ['stripePriceId'],
      data: {
        stripePriceId: price.id,
      },
    });
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to create Stripe price.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to create Stripe price: ${reason}`);
  }
};

const updateStripePrice = async (
  stripePriceId: string,
  data: StripePriceLifecycleData
): Promise<void> => {
  const payload = buildPriceUpdatePayload(data);

  if (Object.keys(payload).length === 0) {
    return;
  }

  try {
    const stripe = getStripeClient();
    await stripe.prices.update(stripePriceId, payload);
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to update Stripe price.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to update Stripe price: ${reason}`);
  }
};

const archiveStripePrice = async (stripePriceId: string): Promise<void> => {
  try {
    const stripe = getStripeClient();

    await stripe.prices.update(stripePriceId, { active: false });
  } catch (error) {
    strapi.log.error('[stripe-strapi-plugin] Failed to archive Stripe price.', error);

    const reason = error instanceof Error ? error.message : 'Unknown error';

    throw new errors.ApplicationError(`Failed to archive Stripe price: ${reason}`);
  }
};

const shouldSkipStripeSync = () => {
  return isRunningInStripeSyncContext();
};

export default {
  async afterCreate(event: LifecycleEvent) {
    const data = event.params?.data;

    if (!data || data.stripePriceId) {
      return;
    }

    await createStripePrice(event);
  },

  async beforeUpdate(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const data = event.params?.data;

    if (!data) {
      return;
    }

    const stripePriceId = resolveStripePriceIdForEvent(event);

    if (!stripePriceId) {
      return;
    }

    await updateStripePrice(stripePriceId, data);
  },

  async afterDelete(event: LifecycleEvent) {
    if (shouldSkipStripeSync()) {
      return;
    }

    const stripePriceId = resolveStripePriceIdForEvent(event);

    if (!stripePriceId) {
      return;
    }

    await archiveStripePrice(stripePriceId);
  },
};
