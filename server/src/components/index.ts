import type { Core } from '@strapi/strapi';

import keyValuePairs from './component/key-value-pairs.json';
import priceCustomUnitAmount from './stripe/price-custom-unit-amount.json';
import priceRecurring from './stripe/price-recurring.json';
import priceTier from './stripe/price-tier.json';
import promotionCodeRestrictions from './stripe/promotion-code-restrictions.json';

const rawComponents = {
  component: {
    'key-value-pairs': keyValuePairs,
  },
  stripe: {
    'price-custom-unit-amount': priceCustomUnitAmount,
    'price-recurring': priceRecurring,
    'price-tier': priceTier,
    'promotion-code-restrictions': promotionCodeRestrictions,
  },
};

const upperFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const toCamelCase = (value: string) => {
  const parts = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (!parts.length) {
    return '';
  }

  const [first, ...rest] = parts;
  return first.toLowerCase() + rest.map((part) => upperFirst(part.toLowerCase())).join('');
};

export const registerComponents = (strapi: Core.Strapi) => {
  const components: Record<string, unknown> = {};

  Object.entries(rawComponents).forEach(([category, schemas]) => {
    Object.entries(schemas).forEach(([name, schema]) => {
      const uid = `${category}.${name}`;
      const schemaClone = JSON.parse(JSON.stringify(schema));

      components[uid] = {
        ...schema,
        __schema__: schemaClone,
        uid,
        category,
        modelType: 'component',
        modelName: name,
        globalId: upperFirst(toCamelCase(`component_${uid.replace(/\./g, '_')}`)),
      };
    });
  });

  strapi.get('components').add(components);
};

export default rawComponents;
