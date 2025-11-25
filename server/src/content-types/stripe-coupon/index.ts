import { STRIPE_CURRENCIES } from '../shared/currencies';

export default {
  kind: 'collectionType',
  collectionName: 'stripe_coupons',
  info: {
    singularName: 'stripe-coupon',
    pluralName: 'stripe-coupons',
    displayName: 'Stripe Coupons',
  },
  options: {
    draftAndPublish: false,
  },
  pluginOptions: {
    'content-manager': {
      visible: true,
    },
    'content-type-builder': {
      visible: true,
    },
  },
  attributes: {
    stripeCouponId: {
      type: 'string',
      unique: true,
    },
    name: {
      type: 'string',
    },
    duration: {
      type: 'enumeration',
      enum: ['forever', 'once', 'repeating'],
      required: true,
    },
    durationInMonths: {
      type: 'integer',
    },
    amountOff: {
      type: 'integer',
    },
    percentOff: {
      type: 'float',
    },
    currency: {
      type: 'enumeration',
      enum: STRIPE_CURRENCIES,
    },
    redeemBy: {
      type: 'datetime',
    },
    maxRedemptions: {
      type: 'integer',
    },
    timesRedeemed: {
      type: 'integer',
    },
    appliesToProducts: {
      type: 'relation',
      relation: 'manyToMany',
      target: 'plugin::stripe-strapi-plugin.stripe-product',
      inversedBy: 'applicableCoupons',
    },
    livemode: {
      type: 'boolean',
    },
    valid: {
      type: 'boolean',
    },
    metadata: {
      type: 'component',
      component: 'component.key-value-pairs',
      repeatable: true,
    },
    created: {
      type: 'datetime',
    },
    promotionCodes: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::stripe-strapi-plugin.stripe-promotion-code',
      mappedBy: 'stripeCoupon',
    },
  },
};
