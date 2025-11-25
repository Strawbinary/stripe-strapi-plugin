import { type Core, factories } from '@strapi/strapi';
import type { Context } from 'koa';
import { errors } from '@strapi/utils';

import { PLUGIN_ID, STRIPE_PROMOTION_CODE_UID } from '../constants';

const buildQuery = (ctx: Context) => {
  if (!ctx?.query || typeof ctx.query !== 'object') {
    return {};
  }

  return ctx.query;
};

const getDocumentsApi = () => {
  const documentsApi = strapi.documents;

  if (typeof documentsApi !== 'function') {
    throw new errors.ApplicationError(
      '[stripe-strapi-plugin] Document service API is unavailable for stripe promotion codes.'
    );
  }

  return documentsApi(STRIPE_PROMOTION_CODE_UID);
};

export default factories.createCoreController(
  `plugin::${PLUGIN_ID}.stripe-promotion-code`,
  ({ strapi }) => ({
    async find(ctx) {
      const documentsApi = getDocumentsApi();
      const query = buildQuery(ctx) as Parameters<typeof documentsApi.findMany>[0];

      const promotionCodes = await documentsApi.findMany(query);

      ctx.body = promotionCodes;
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

      const promotionCode = await documentsApi.findOne({
        ...(query ?? {}),
        documentId,
      });

      if (!promotionCode) {
        ctx.notFound('Stripe promotion code not found');
        return;
      }

      ctx.body = promotionCode;
    },
  })
);
