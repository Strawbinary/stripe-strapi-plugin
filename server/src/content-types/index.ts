import stripeProductSchema from './stripe-product';
import stripeProductLifecycles from './stripe-product/lifecycles';

export default {
  'stripe-product': {
    schema: stripeProductSchema,
    lifecycles: stripeProductLifecycles,
  },
};
