import stripeProductSchema from './stripe-product';
import stripeProductLifecycles from './stripe-product/lifecycles';
import stripePriceSchema from './stripe-price';
import stripePriceLifecycles from './stripe-price/lifecycles';

export default {
  'stripe-product': {
    schema: stripeProductSchema,
    lifecycles: stripeProductLifecycles,
  },
  'stripe-price': {
    schema: stripePriceSchema,
    lifecycles: stripePriceLifecycles,
  },
};
