export type StripeCronConfig = {
  enabled?: boolean;
  expression?: string;
};

export type StripePluginConfig = {
  secretKey?: string;
  stripeSecretKey?: string;
  webhookSecret?: string;
  alwaysRunMigration?: boolean;
  sync?: {
    cron?: StripeCronConfig;
  };
};

export type ResolvedStripePluginConfig = {
  secretKey: string | null;
  stripeSecretKey?: string;
  webhookSecret: string | null;
  alwaysRunMigration?: boolean;
  sync: {
    cron: {
      enabled: boolean;
      expression: string;
    };
  };
};
