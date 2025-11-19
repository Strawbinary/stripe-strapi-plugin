export default [
  {
    method: 'GET',
    path: '/',
    // name of the controller file & the method.
    handler: 'controller.index',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/stripe-products',
    handler: 'controller.find',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/stripe-products/:documentId',
    handler: 'controller.findOne',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/webhooks/stripe',
    handler: 'stripeWebhook.handle',
    config: {
      auth: false,
      policies: [],
    },
  },
];
