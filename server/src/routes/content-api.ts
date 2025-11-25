export default [
  {
    method: 'GET',
    path: '/',
    handler: 'stripe-product.index',
  },
  {
    method: 'GET',
    path: '/stripe-products',
    handler: 'stripe-product.find',
  },
  {
    method: 'GET',
    path: '/stripe-products/:documentId',
    handler: 'stripe-product.findOne',
  },
  {
    method: 'GET',
    path: '/stripe-coupons',
    handler: 'stripe-coupon.find',
  },
  {
    method: 'GET',
    path: '/stripe-coupons/:documentId',
    handler: 'stripe-coupon.findOne',
  },
  {
    method: 'GET',
    path: '/stripe-prices',
    handler: 'stripe-price.find',
  },
  {
    method: 'GET',
    path: '/stripe-prices/:documentId',
    handler: 'stripe-price.findOne',
  },
  {
    method: 'GET',
    path: '/stripe-promotion-codes',
    handler: 'stripe-promotion-code.find',
  },
  {
    method: 'GET',
    path: '/stripe-promotion-codes/:documentId',
    handler: 'stripe-promotion-code.findOne',
  },
];
