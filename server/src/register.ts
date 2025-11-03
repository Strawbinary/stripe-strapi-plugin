import type { Core } from '@strapi/strapi';

import { registerComponents } from './components';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  registerComponents(strapi);
};

export default register;
