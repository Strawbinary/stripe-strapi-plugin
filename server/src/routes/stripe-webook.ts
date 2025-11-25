export default [
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
