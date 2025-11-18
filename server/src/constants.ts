export const PLUGIN_ID = 'stripe-strapi-plugin';
export const STRIPE_PRODUCT_UID = `plugin::${PLUGIN_ID}.stripe-product`;
export const DEFAULT_CRON_EXPRESSION = '0 */10 * * * *';
export const STRIPE_SYNC_CRON_JOB_NAME = `${PLUGIN_ID}::sync`;
