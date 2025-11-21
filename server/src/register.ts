import type { Core } from '@strapi/strapi';

import { registerComponents } from './components';
import { STRIPE_SYNC_CRON_JOB_NAME } from './constants';
import { resolvePluginConfig } from './stripe/config';

const register = async ({ strapi }: { strapi: Core.Strapi }) => {
  await registerComponents(strapi);

  const pluginConfig = resolvePluginConfig(strapi);

  if (!pluginConfig.sync.cron.enabled || !strapi.cron) {
    return;
  }

  const cronExpression = pluginConfig.sync.cron.expression;

  strapi.cron.add({
    [STRIPE_SYNC_CRON_JOB_NAME]: {
      options: { rule: cronExpression },
      task: async () => {
        const syncService = strapi.plugin('stripe-strapi-plugin').service('stripeSync');

        try {
          await syncService.syncAll();
        } catch (error) {
          strapi.log.error(
            `[stripe-strapi-plugin] Cron sync failed for schedule "${cronExpression}".`,
            error
          );
        }
      },
    },
  });

  strapi.log.info(`[stripe-strapi-plugin] Cron sync enabled. Schedule "${cronExpression}".`);
};

export default register;
