import type { Core } from '@strapi/strapi';

import runInitialStripeProductMigration from './migrations/run-initial-stripe-product-migration';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const store = strapi.store({ type: 'plugin', name: 'stripe-strapi-plugin' });
  const migrationAlreadyRun = await store.get({ key: 'initialProductsMigrationCompleted' });

  const pluginConfig = strapi.config.get('plugin.stripe-strapi-plugin', {}) as {
    secretKey?: string;
    stripeSecretKey?: string;
    alwaysRunMigration?: boolean;
  };

  if (migrationAlreadyRun && !pluginConfig.alwaysRunMigration) {
    return;
  }

  const secretKey =
    pluginConfig.secretKey ?? pluginConfig.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    strapi.log.warn(
      '[stripe-strapi-plugin] No Stripe secret key provided. Skipping initial product migration.'
    );
    return;
  }

  await runInitialStripeProductMigration({ strapi, secretKey, store });
};

export default bootstrap;
