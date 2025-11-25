import controller from './controller';
import stripeCoupon from './stripe-coupon';
import stripePrice from './stripe-price';
import stripePromotionCode from './stripe-promotion-code';
import stripeWebhook from './stripe-webhook';

export default {
  'stripe-product': controller,
  'stripe-coupon': stripeCoupon,
  'stripe-price': stripePrice,
  'stripe-promotion-code': stripePromotionCode,
  stripeWebhook,
};
