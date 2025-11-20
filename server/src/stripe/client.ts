import Stripe from 'stripe';
import { errors } from '@strapi/utils';

import { STRIPE_API_VERSION } from './constants';
import { resolvePluginConfig } from './config';

const resolveSecretKey = (): string => {
  const secretKey = resolvePluginConfig(strapi).secretKey;

  if (!secretKey) {
    throw new errors.ApplicationError(
      'No Stripe secret key configured. Please configure it in the plugin.'
    );
  }

  return secretKey;
};

export const getStripeClient = () => {
  const secretKey = resolveSecretKey();

  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
};

export const getSecretKey = resolveSecretKey;
