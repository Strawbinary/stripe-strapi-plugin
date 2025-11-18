import type { Core } from '@strapi/strapi';

import { DEFAULT_CRON_EXPRESSION, PLUGIN_ID } from '../constants';
import type { ResolvedStripePluginConfig, StripePluginConfig } from '../types/config';

export const resolvePluginConfig = (strapi: Core.Strapi): ResolvedStripePluginConfig => {
  const rawConfig = strapi.config.get(`plugin::${PLUGIN_ID}`, {}) as StripePluginConfig;
  const cronExpression =
    typeof rawConfig?.sync?.cron?.expression === 'string' &&
    rawConfig.sync.cron.expression.trim().length > 0
      ? rawConfig.sync.cron.expression.trim()
      : DEFAULT_CRON_EXPRESSION;

  return {
    ...rawConfig,
    secretKey:
      rawConfig.secretKey ?? rawConfig.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY ?? null,
    webhookSecret: rawConfig.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? null,
    sync: {
      cron: {
        enabled: Boolean(rawConfig?.sync?.cron?.enabled),
        expression: cronExpression,
      },
    },
  };
};
