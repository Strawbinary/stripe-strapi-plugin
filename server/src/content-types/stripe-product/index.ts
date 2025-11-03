export default {
  kind: 'collectionType',
  collectionName: 'stripe_products',
  info: {
    singularName: 'stripe-product',
    pluralName: 'stripe-products',
    displayName: 'Stripe Produkte',
  },
  options: {
    draftAndPublish: true,
  },
  pluginOptions: {},
  attributes: {
    name: {
      type: 'string',
      required: true,
    },
    stripeProductId: {
      type: 'string',
      required: false,
      unique: true,
    },
    description: {
      type: 'text',
    },
    imageUrl: {
      type: 'string',
    },
    taxCode: {
      type: 'enumeration',
      required: true,
      default: 'txcd_10000000',
      enum: ['txcd_10000000'],
    },
    active: {
      type: 'boolean',
      required: true,
      default: true,
    },
    // metadata: {
    //   type: 'component',
    //   component: 'component.key-value-pairs',
    //   repeatable: true,
    // },
  },
};
