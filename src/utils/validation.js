import { z } from 'zod';

// Validation schemas for tool parameters
export const ValidationSchemas = {
  paginationUrl: z.object({
    url: z.string().url('Invalid URL format'),
  }),

  accountDetails: z.object({
    act_id: z.string().min(1, 'act_id is required'),
    fields: z.array(z.string()).optional(),
  }),

  accountInsights: z.object({
    act_id: z.string().min(1, 'act_id is required'),
    fields: z.array(z.string()).min(1, 'At least one field is required'),
    date_preset: z.string().optional(),
    level: z.string().optional(),
    action_attribution_windows: z.array(z.string()).optional(),
    action_breakdowns: z.array(z.string()).optional(),
    breakdowns: z.array(z.string()).optional(),
    time_range: z.object({
      since: z.string(),
      until: z.string(),
    }).optional(),
    limit: z.number().positive().optional(),
    sort: z.string().optional(),
    after: z.string().optional(),
    before: z.string().optional(),
    time_increment: z.union([z.string(), z.number()]).optional(),
  }),

  accountActivities: z.object({
    act_id: z.string().min(1, 'act_id is required'),
    fields: z.array(z.string()).optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    time_range: z.object({
      since: z.string(),
      until: z.string(),
    }).optional(),
    limit: z.number().positive().optional(),
    after: z.string().optional(),
    before: z.string().optional(),
  }),

  adCreatives: z.object({
    act_id: z.string().min(1, 'act_id is required'),
    min_purchase_events: z.number().optional(),
    max_cost_per_purchase: z.number().optional(),
    include_images: z.boolean().optional(),
    date_range_days: z.number().optional(),
    limit: z.number().optional(),
  }),

  adThumbnails: z.object({
    ad_ids: z.array(z.string()).min(1, 'At least one ad ID is required'),
    resolution: z.enum(['thumbnail', 'full', 'all']).optional(),
    include_ad_details: z.boolean().optional(),
  }),

  adThumbnailsEmbedded: z.object({
    ad_ids: z.array(z.string()).min(1, 'At least one ad ID is required'),
    resolution: z.enum(['thumbnail', 'full', 'all']).optional(),
    include_ad_details: z.boolean().optional(),
    cache_duration_hours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
    max_image_size_mb: z.number().min(0.1).max(10).optional(), // 100KB to 10MB
  }),

  // AppsFlyer validation schemas
  appsflyerCheckAuth: z.object({
    client_id: z.string().min(1, 'Client ID is required'),
  }),

  appsflyerListClients: z.object({}),

  appsflyerListApps: z.object({
    client_id: z.string().min(1, 'Client ID is required'),
    limit: z.number().min(1).max(1000).optional(),
    offset: z.number().min(0).optional(),
  }),

  appsflyerGetInstalls: z.object({
    client_id: z.string().min(1, 'Client ID is required'),
    app_id: z.string().min(1, 'App ID is required'),
    date_range: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'From date must be in YYYY-MM-DD format'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'To date must be in YYYY-MM-DD format'),
    }),
    timezone: z.string().optional(),
    media_sources: z.array(z.string()).optional(),
  }),

  appsflyerGetEvents: z.object({
    client_id: z.string().min(1, 'Client ID is required'),
    app_id: z.string().min(1, 'App ID is required'),
    date_range: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'From date must be in YYYY-MM-DD format'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'To date must be in YYYY-MM-DD format'),
    }),
    event_names: z.array(z.string()).optional(),
    timezone: z.string().optional(),
  }),

  appsflyerGetOverview: z.object({
    client_id: z.string().min(1, 'Client ID is required'),
    app_id: z.string().min(1, 'App ID is required'),
    date_range: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'From date must be in YYYY-MM-DD format'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'To date must be in YYYY-MM-DD format'),
    }),
    grouping: z.enum(['day', 'week', 'month']).optional(),
    timezone: z.string().optional(),
  }),
};

export function validateParameters(schema, params) {
  try {
    return schema.parse(params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Validation error: ${messages.join(', ')}`);
    }
    throw error;
  }
}