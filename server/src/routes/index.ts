import contentAPIRoutes from './content-api';
import stripeWebbhokAPIRoutes from './stripe-webook';

const routes = {
  'content-api': {
    type: 'content-api',
    routes: contentAPIRoutes,
  },
  stripeWebhook: {
    type: 'content-api',
    routes: stripeWebbhokAPIRoutes,
  },
};

export default routes;
