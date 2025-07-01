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