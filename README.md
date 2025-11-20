# Strapi 5 - Stripe Plugin

<div align="center" >
  <img src="public/assets/Stripe_wordmark_Blurple.png" alt="Stripe Logo" width="200" style="margin-left: auto;margin-right: auto;"/> 
</div>

<p align="center">
  <a href="https://www.npmjs.com/package/@strawbinary-io/">
    <img src="https://img.shields.io/npm/v/" alt="NPM Version" />
  </a>
</p>

A powerful Strapi plugin to easily manage and sync your Stripe Products, Prices, Coupons and more – directly in your project.

<img src="public/assets/Strawbinary_Plugin_Logo_dark_outlined.svg" alt="Strawbinary Plugin Logo" width="200"/>

**Core Contributor**: [Strawbinary](https://github.com/Strawbinary) <br>
**Follow**: [@strawbinary](https://www.linkedin.com/company/strawbinary-gbr/) <br>
**Website**: [Strawbinary](https://strawbinary.com)

---

## Overview

This Strapi plugin synchronizes Stripe products, prices, coupons, and promotion codes with dedicated content types. It imports the full catalog once during bootstrap, keeps everything up to date through Stripe webhooks, and can optionally run on a cron schedule. All data flows through the Strapi Document Service to respect draft/publish workflows.

## ✨ Features

- Provides the **Stripe Products** collection type (name, `stripeProductId`, description, image URL, tax code, active flag, and a flexible metadata component). Coupons and promotion codes reference products directly through relations.
- Provides the **Stripe Prices** collection type (relation to a Stripe product, `stripePriceId`, billing details, recurring configuration, tiers, currency, metadata, and lookup helpers).
- Provides the **Stripe Coupons** collection type (relation to many Stripe products, `stripeCouponId`, duration configuration, amount-or-percent off fields, redeem-by, metadata, validity flags, and live Stripe statistics).
- Provides the **Stripe Promotion Codes** collection type (relation to a Stripe coupon, `stripePromotionCodeId`, code, active flag, redemption/customer limits, restrictions, metadata, and live Stripe statistics).
- Performs an initial import of all Stripe products when the Strapi app starts and keeps the entire catalog aligned afterwards.
- Optional cron job (default: every 10 minutes) that keeps Strapi in sync with Stripe for products, prices, coupons, and promotion codes.
- Webhook endpoint `POST /api/stripe-strapi-plugin/webhooks/stripe` handling `product.*`, `price.*`, `coupon.*`, and `promotion_code.*` events.
- Service API `strapi.plugin('stripe-strapi-plugin').service('stripeSync')` you can call from custom jobs or scripts (helpers for products, prices, coupons, promotion codes, and a combined `syncAll`).

## 🖐 Requirements

- Strapi v5 with the Document Service enabled (the plugin relies on `strapi.documents` for upserts).
- Stripe secret key with permissions to read products, prices, coupons, and promotion codes (`Stripe API Version: 2025-10-29.clover`).
- Optional Stripe webhook secret for product, price, coupon, and promotion-code events.
- Node.js version that matches your Strapi project requirements.

## ⏳ Installation

```bash
npm install stripe-strapi-plugin
# or
yarn add stripe-strapi-plugin
```

Register the plugin in `config/plugins.ts`:

```ts
export default ({ env }) => ({
  'stripe-strapi-plugin': {
    enabled: true,
    config: {
      secretKey: env('STRIPE_SECRET_KEY'),
      webhookSecret: env('STRIPE_WEBHOOK_SECRET'),
      alwaysRunMigration: false,
      sync: {
        cron: {
          enabled: true,
          expression: '0 */10 * * * *', // Default: every 10 minutes
        },
      },
    },
  },
});
```

**Note:** You can provide the key as `secretKey`, `stripeSecretKey`, or via the `STRIPE_SECRET_KEY` environment variable. `webhookSecret` can also come from `STRIPE_WEBHOOK_SECRET`.

## 🔧 Configuration Reference

| Option                          | Type      | Description                                                                                                                           |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `secretKey` / `stripeSecretKey` | `string`  | Stripe secret key used for API calls. Falls back to `process.env.STRIPE_SECRET_KEY` when not explicitly set.                          |
| `webhookSecret`                 | `string`  | Secret from the Stripe webhook configuration, required for signature verification. Falls back to `process.env.STRIPE_WEBHOOK_SECRET`. |
| `alwaysRunMigration`            | `boolean` | Forces the initial product import to run on every bootstrap. Default: `false` (skips once the first run succeeded).                   |
| `sync.cron.enabled`             | `boolean` | Enables or disables the automatic cron sync. Default: `false`.                                                                        |
| `sync.cron.expression`          | `string`  | Cron expression (refer to [Strapi Documentation](https://docs.strapi.io/cms/configurations/cron)). Default: `0 */10 * * * *`.         |

### Configure the Body Parser

The webhook controller needs access to the raw request body (`includeUnparsed: true`) to validate Stripe signatures. Update `config/middlewares.ts` accordingly:

```ts
export default [
  'strapi::cors',
  'strapi::logger',
  {
    name: 'strapi::body',
    config: {
      includeUnparsed: true,
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
```

## Stripe Webhooks

1. Create a webhook in Stripe pointing to `https://<your-domain>/api/stripe-strapi-plugin/webhooks/stripe`.
2. Subscribe to at least `product.created`, `product.updated`, `product.deleted`, `price.created`, `price.updated`, `price.deleted`, `coupon.created`, `coupon.updated`, `coupon.deleted`, `promotion_code.created`, and `promotion_code.updated`.
3. Store the Stripe webhook secret (`webhookSecret`) in the plugin configuration.

The endpoint validates every request via the `stripe-signature` header. If validation fails or the secret is missing, the controller responds with an error status.

## Synchronization Strategy

- **Initial import:** During bootstrap the plugin checks the plugin store for a previous migration run. If none is found (or `alwaysRunMigration` is `true`), every Stripe product is imported once and published.
- **Cron sync:** When enabled, the cron job periodically calls Stripe's APIs and upserts products, prices, coupons, and promotion codes (in that order). The configured schedule is logged and cleaned up during shutdown.
- **Webhooks:** Stripe sends product, price, coupon, and promotion-code events that are immediately upserted or deleted through the Document Service. Unsupported events are logged at debug level.
- **Manual sync:** Custom jobs can call `await strapi.plugin('stripe-strapi-plugin').service('stripeSync').syncAll();` whenever needed (products + prices + coupons + promotion codes). Dedicated helpers `syncProducts`, `syncPrices`, `syncCoupons`, and `syncPromotionCodes` are also exposed.
- **Deletion behaviour for Prices:** Stripe only supports archiving prices. When you delete a Stripe Price entry in Strapi we archive the price in Stripe, but it still exists in your Stripe account and will therefore be recreated in Strapi on the next webhook or cron sync. Keep this in mind when cleaning up your catalog.

## Content Types & Components

- **`plugin::stripe-strapi-plugin.stripe-product`:** Stores the product name, unique `stripeProductId`, optional description and image URL, required `taxCode` (Enum mapped to Stripe tax codes), boolean `active` flag, and the metadata component. Prices, coupons, and promotion codes link back to the product through relations.
- **`plugin::stripe-strapi-plugin.stripe-price`:** Stores every Stripe price (`stripePriceId`) including the related product, currency, billing scheme, recurring configuration, tiers, unit amounts, tax behavior, metadata and Stripe lookup keys.
- **`plugin::stripe-strapi-plugin.stripe-coupon`:** Stores Stripe coupons (`stripeCouponId`) including duration, amount/percent configuration, redeem-by timestamp, redemption counters, relations to the products the coupon applies to, metadata, and the live Stripe status flags.
- **`plugin::stripe-strapi-plugin.stripe-promotion-code`:** Stores promotion codes (`stripePromotionCodeId`) including the human-readable code, activation flags, redemption limits, per-customer restrictions, relations to the parent coupon, metadata, and live Stripe stats.
- **Component `stripe.price-custom-unit-amount`:** Mirrors Stripe's `custom_unit_amount` object (minimum/maximum/preset).
- **Component `stripe.price-recurring`:** Captures recurring settings (interval, interval count, meter, usage type).
- **Component `stripe.price-tier`:** Stores tier definitions (flat and unit amounts plus the upper bound).
- **Component `stripe.promotion-code-restrictions`:** Captures the promotion-code restriction values (first-time flag and optional minimum amount/currency).
- **Component `component.key-value-pairs`:** Captures arbitrary Stripe metadata as key/value pairs and is kept in sync both ways.

## 👤 Permissions

Configure fine-grained permissions under **Roles & Permissions** → **Plugins**.

## 🤝 Contributing

We welcome contributions, issues and feature requests!

- Report bugs or request features in the [issue tracker](https://github.com/Strawbinary/stripe-strapi-plugin/issues)

## 📚 References

- [Stripe Documentation](https://docs.stripe.com/)
- [Strapi Documentation](https://docs.strapi.io)
