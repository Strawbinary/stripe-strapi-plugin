import stripeProductSchema from './stripe-product';
import stripeProductLifecycles from './stripe-product/lifecycles';
import stripePriceSchema from './stripe-price';
import stripePriceLifecycles from './stripe-price/lifecycles';
import stripeCouponSchema from './stripe-coupon';
import stripeCouponLifecycles from './stripe-coupon/lifecycles';
import stripePromotionCodeSchema from './stripe-promotion-code';
import stripePromotionCodeLifecycles from './stripe-promotion-code/lifecycles';

export default {
  'stripe-product': {
    schema: stripeProductSchema,
    lifecycles: stripeProductLifecycles,
  },
  'stripe-price': {
    schema: stripePriceSchema,
    lifecycles: stripePriceLifecycles,
  },
  'stripe-coupon': {
    schema: stripeCouponSchema,
    lifecycles: stripeCouponLifecycles,
  },
  'stripe-promotion-code': {
    schema: stripePromotionCodeSchema,
    lifecycles: stripePromotionCodeLifecycles,
  },
};
