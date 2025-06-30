import { FacebookAPIClient } from '../utils/facebook-api.js';
import { createErrorResponse } from '../utils/error-handler.js';
import { ValidationSchemas, validateParameters } from '../utils/validation.js';

export async function getAccountInsights(args) {
  try {
    // Validate input parameters
    const validatedArgs = validateParameters(ValidationSchemas.accountInsights, args);
    const { act_id, fields, ...otherParams } = validatedArgs;

    const client = new FacebookAPIClient();
    
    const params = {
      fields: fields.join(','),
      ...otherParams,
    };

    // Remove undefined/null values and format arrays
    Object.keys(params).forEach(key => {
      if (params[key] === undefined || params[key] === null) {
        delete params[key];
      } else if (Array.isArray(params[key])) {
        params[key] = params[key].join(',');
      }
    });

    const data = await client.makeRequest(`/${act_id}/insights`, params);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (error) {
    return createErrorResponse(error);
  }
}