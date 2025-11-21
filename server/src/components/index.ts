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
const buildGlobalId = (uid: string) => upperFirst(toCamelCase(`component_${uid.replace(/\./g, '_')}`));

export const registerComponents = async (strapi: Core.Strapi) => {
  const componentService = strapi.plugin('content-type-builder').services.components;
  const existingComponents = strapi.components ?? ({} as Core.Strapi['components']);
  const memoryComponents = (strapi.components ??= {} as Core.Strapi['components']);

  for (const [category, schemas] of Object.entries(rawComponents)) {
    for (const [name, schema] of Object.entries(schemas)) {
      const uid = `${category}.${name}`;

      if (existingComponents[uid]) {
        continue;
      }

      const { info = {}, attributes, pluginOptions, config } = schema as {
        info?: { displayName?: string; icon?: string; description?: string };
        attributes: Record<string, unknown>;
        pluginOptions?: Record<string, unknown>;
        config?: Record<string, unknown>;
      };

      await componentService.createComponent({
        component: {
          category,
          displayName: info.displayName,
          icon: info.icon,
          description: info.description,
          attributes,
          pluginOptions,
          config,
        },
      });

      // Register in-memory so Strapi can resolve the component immediately on first start
      const schemaClone = JSON.parse(JSON.stringify(schema));
      memoryComponents[uid] = {
        ...schema,
        __schema__: schemaClone,
        __filename__: `${name}.json`,
        uid,
        category,
        modelType: 'component',
        modelName: name,
        globalId: buildGlobalId(uid),
        config: config ?? {},
      };
    }
  }
};

export default rawComponents;
