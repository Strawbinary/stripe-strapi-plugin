export default {
  kind: 'collectionType',
  collectionName: 'stripe_promotion_codes',
  info: {
    singularName: 'stripe-promotion-code',
    pluralName: 'stripe-promotion-codes',
    displayName: 'Stripe Promotion Codes',
  },
  options: {
    draftAndPublish: false,
  },
  pluginOptions: {},
  attributes: {
    stripePromotionCodeId: {
      type: 'string',
      unique: true,
    },
    code: {
      type: 'string',
      required: true,
      unique: true,
    },
    active: {
      type: 'boolean',
      default: true,
    },
    customer: {
      type: 'string',
    },
    expiresAt: {
      type: 'datetime',
    },
    livemode: {
      type: 'boolean',
    },
    maxRedemptions: {
      type: 'integer',
    },
    timesRedeemed: {
      type: 'integer',
    },
    restrictions: {
      type: 'component',
      component: 'stripe.promotion-code-restrictions',
    },
    metadata: {
      type: 'component',
      component: 'component.key-value-pairs',
      repeatable: true,
    },
    created: {
      type: 'datetime',
    },
    stripeCoupon: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::stripe-strapi-plugin.stripe-coupon',
      inversedBy: 'promotionCodes',
      required: true,
    },
  },
};
