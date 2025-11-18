# Strapi 5 - Stripe Plugin

<div style="display: flex; flex-direction: column; gap: 16px;">
  <div style="display: flex">
    <img src="public/assets/Stripe_wordmark_Blurple.png" alt="Stripe Logo" width="200" style="margin-left: auto;margin-right: auto;"/> 
  </div>

  <p align="center">
    <a href="https://www.npmjs.com/package/@strawbinary-io/">
      <img src="https://img.shields.io/npm/v/" alt="NPM Version" />
    </a>
  </p>
</div>

A powerful Strapi plugin to easily manage and sync your Stripe Products, Prices, Coupons and more – directly in your project.

**Core Contributor**: [Strawbinary](https://github.com/Strawbinary)  
**Follow** [@strawbinary](https://www.linkedin.com/company/strawbinary-gbr/)

---

## Overview

This Strapi plugin synchronizes Stripe products with a dedicated `stripe-product` content type. It imports the full catalog once during bootstrap, keeps everything up to date through Stripe webhooks, and can optionally run on a cron schedule. All data flows through the Strapi Document Service to respect draft/publish workflows.

## ✨ Features

- Provides the **Stripe Products** collection type (name, `stripeProductId`, description, image URL, tax code, active flag, and a flexible metadata component).
- Performs an initial import of all Stripe products when the Strapi app starts.
- Optional cron job (default: every 10 minutes) that keeps Strapi in sync with Stripe.
- Webhook endpoint `POST /api/stripe-strapi-plugin/webhooks/stripe` handling `product.created`, `product.updated`, and `product.deleted`.
- Service API `strapi.plugin('stripe-strapi-plugin').service('stripeSync')` you can call from custom jobs or scripts.

## 🖐 Requirements

- Strapi v5 with the Document Service enabled (the plugin relies on `strapi.documents` for upserts).
- Stripe secret key with permissions to read products (`Stripe API Version: 2025-10-29.clover`).
- Optional Stripe webhook secret for product events.
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
2. Subscribe to at least `product.created`, `product.updated`, and `product.deleted`.
3. Store the Stripe webhook secret (`webhookSecret`) in the plugin configuration.

The endpoint validates every request via the `stripe-signature` header. If validation fails or the secret is missing, the controller responds with an error status.

## Synchronization Strategy

- **Initial import:** During bootstrap the plugin checks the plugin store for a previous migration run. If none is found (or `alwaysRunMigration` is `true`), every Stripe product is imported once and published.
- **Cron sync:** When enabled, the cron job periodically calls `stripe.products.list` and upserts all products. The configured schedule is logged and cleaned up during shutdown.
- **Webhooks:** Stripe sends product events that are immediately upserted or deleted through the Document Service. Unsupported events are logged at debug level.
- **Manual sync:** Custom jobs can call `await strapi.plugin('stripe-strapi-plugin').service('stripeSync').syncAll();` whenever needed.

## Content Types & Components

- **`plugin::stripe-strapi-plugin.stripe-product`:** Stores the product name, unique `stripeProductId`, optional description and image URL, required `taxCode` (Enum mapped to Stripe tax codes), boolean `active` flag, and the metadata component.
- **Component `component.key-value-pairs`:** Captures arbitrary Stripe metadata as key/value pairs and is kept in sync both ways.

## 👤 Permissions

Configure fine-grained permissions under **Roles & Permissions** → **Plugins**.

## 🤝 Contributing

We welcome contributions, issues and feature requests!

- Report bugs or request features in the [issue tracker](https://github.com/Strawbinary/stripe-strapi-plugin/issues)

## 📚 References

- [Stripe Documentation](https://docs.stripe.com/)
- [Strapi Documentation](https://docs.strapi.io)
