import type { Core } from '@strapi/strapi';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  index(ctx) {
    const syncConfig = strapi.plugin('stripe-strapi-plugin').service('stripeSync').getConfig();

    ctx.body = {
      message: 'Stripe plugin is ready',
      cron: syncConfig.sync.cron,
    };
  },
});

export default controller;
