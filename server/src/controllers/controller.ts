import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { errors } from '@strapi/utils';

import { STRIPE_PRODUCT_UID } from '../constants';

const controller = ({ strapi }: { strapi: Core.Strapi }) => {
  const getDocumentsApi = () => {
    const documentsApi = strapi.documents;

    if (typeof documentsApi !== 'function') {
      throw new errors.ApplicationError(
        '[stripe-strapi-plugin] Document service API is unavailable for stripe products.'
      );
    }

    return documentsApi(STRIPE_PRODUCT_UID);
  };

  const buildQuery = (ctx: Context) => {
    if (!ctx?.query || typeof ctx.query !== 'object') {
      return {};
    }

    return ctx.query;
  };

  return {
    index(ctx) {
      const syncConfig = strapi.plugin('stripe-strapi-plugin').service('stripeSync').getConfig();

      ctx.body = {
        message: 'Stripe plugin is ready',
        cron: syncConfig.sync.cron,
      };
    },

    async find(ctx) {
      const documentsApi = getDocumentsApi();
      const query = buildQuery(ctx) as Parameters<typeof documentsApi.findMany>[0];

      const products = await documentsApi.findMany(query);

      ctx.body = products;
    },

    async findOne(ctx) {
      const documentsApi = getDocumentsApi();
      const query = buildQuery(ctx) as Omit<
        Parameters<typeof documentsApi.findOne>[0],
        'documentId'
      >;
      const documentId = ctx.params?.documentId ?? ctx.params?.id;

      if (!documentId) {
        ctx.throw(400, 'Missing documentId parameter');
        return;
      }

      const product = await documentsApi.findOne({
        ...(query ?? {}),
        documentId,
      });

      if (!product) {
        ctx.notFound('Stripe product not found');
        return;
      }

      ctx.body = product;
    },
  };
};

export default controller;
