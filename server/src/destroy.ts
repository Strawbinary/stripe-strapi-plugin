import type { Core } from '@strapi/strapi';

import { STRIPE_SYNC_CRON_JOB_NAME } from './constants';

const destroy = ({ strapi }: { strapi: Core.Strapi }) => {
  if (strapi?.cron) {
    try {
      strapi.cron.remove(STRIPE_SYNC_CRON_JOB_NAME);
    } catch (error) {
      strapi.log.warn('[stripe-strapi-plugin] Failed to remove cron job on destroy.', error);
    }
  }
};

export default destroy;
