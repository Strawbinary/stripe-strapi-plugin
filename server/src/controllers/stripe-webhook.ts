import type { Core } from '@strapi/strapi';
import Stripe from 'stripe';

const RAW_BODY_SYMBOL = Symbol.for('unparsedBody');

const stripeWebhookController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async handle(ctx) {
    const syncService = strapi.plugin('stripe-strapi-plugin').service('stripeSync');
    const { webhookSecret } = syncService.getConfig();

    if (!webhookSecret) {
      ctx.status = 503;
      ctx.body = { error: 'Stripe webhook secret is not configured.' };
      return;
    }

    const signatureHeader = ctx.request.headers['stripe-signature'];

    if (typeof signatureHeader !== 'string') {
      ctx.status = 400;
      ctx.body = { error: 'Missing stripe-signature header.' };
      return;
    }

    const parsedBody = ctx.request.body as Record<PropertyKey, unknown> | undefined;
    const rawBody =
      (parsedBody && (Reflect.get(parsedBody, RAW_BODY_SYMBOL) as string | Buffer | undefined)) ||
      (ctx.request as typeof ctx.request & { rawBody?: string | Buffer }).rawBody;

    if (!rawBody) {
      ctx.status = 400;
      ctx.body = {
        error:
          'Unable to access the raw request body. Please enable includeUnparsed for body parsing.',
      };
      return;
    }

    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

    let event: Stripe.Event;

    try {
      const stripe = syncService.getStripeClient();
      event = stripe.webhooks.constructEvent(payload, signatureHeader, webhookSecret);
    } catch (error) {
      strapi.log.warn('[stripe-strapi-plugin] Invalid Stripe webhook signature.', error);
      ctx.status = 400;
      ctx.body = { error: 'Invalid Stripe signature.' };
      return;
    }

    try {
      await syncService.handleWebhookEvent(event);
    } catch (error) {
      strapi.log.error('[stripe-strapi-plugin] Failed to process Stripe webhook event.', error);
      ctx.status = 500;
      ctx.body = { error: 'Failed to process Stripe webhook.' };
      return;
    }

    ctx.body = { received: true };
  },
});

export default stripeWebhookController;
