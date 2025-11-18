import { DEFAULT_CRON_EXPRESSION } from '../constants';
import type { StripePluginConfig } from '../types/config';

const defaultConfig: StripePluginConfig = {
  sync: {
    cron: {
      enabled: false,
      expression: DEFAULT_CRON_EXPRESSION,
    },
  },
};

const isValidCronExpression = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  const parts = value.trim().split(/\s+/);

  return parts.length === 5 || parts.length === 6;
};

export default {
  default: defaultConfig,
  validator(config: StripePluginConfig = {}) {
    const expression = config?.sync?.cron?.expression;

    if (expression && !isValidCronExpression(expression)) {
      throw new Error(
        'Invalid cron expression for the Stripe plugin. Please provide 5 or 6 fields (seconds optional).'
      );
    }
  },
};
