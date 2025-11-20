import { STRIPE_CURRENCIES } from '../shared/currencies';

export default {
  kind: 'collectionType',
  collectionName: 'stripe_prices',
  info: {
    singularName: 'stripe-price',
    pluralName: 'stripe-prices',
    displayName: 'Stripe Prices',
  },
  options: {
    draftAndPublish: false,
  },
  pluginOptions: {},
  attributes: {
    stripePriceId: {
      type: 'string',
      unique: true,
    },
    stripeProduct: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::stripe-strapi-plugin.stripe-product',
      inversedBy: 'stripePrices',
      required: true,
    },
    active: {
      type: 'boolean',
      required: true,
      default: true,
    },
    billingScheme: {
      type: 'enumeration',
      enum: ['per_unit', 'tiered'],
      default: 'per_unit',
      required: true,
    },
    created: {
      type: 'datetime',
    },
    currency: {
      type: 'enumeration',
      required: true,
      enum: STRIPE_CURRENCIES,
    },
    customUnitAmount: {
      type: 'component',
      component: 'stripe.price-custom-unit-amount',
    },
    livemode: {
      type: 'boolean',
    },
    lookupKey: {
      type: 'string',
    },
    metadata: {
      type: 'component',
      component: 'component.key-value-pairs',
      repeatable: true,
    },
    nickname: {
      type: 'string',
    },
    recurring: {
      type: 'component',
      component: 'stripe.price-recurring',
      repeatable: false,
    },
    taxBehavior: {
      type: 'enumeration',
      enum: ['inclusive', 'exclusive', 'unspecified'],
    },
    tiers: {
      type: 'component',
      component: 'stripe.price-tier',
      repeatable: true,
    },
    tiersMode: {
      type: 'enumeration',
      enum: ['graduated', 'volume'],
    },
    type: {
      type: 'enumeration',
      enum: ['one_time', 'recurring'],
      required: true,
    },
    unitAmount: {
      type: 'integer',
    },
    unitAmountDecimal: {
      type: 'string',
    },
  },
};
