import { FacebookAPIClient } from '../utils/facebook-api.js';
import { createErrorResponse } from '../utils/error-handler.js';
import { ValidationSchemas, validateParameters } from '../utils/validation.js';

/**
 * Universal Event Detection Logic
 * Maps adset configurations to actual performance data to prevent event hallucination
 */

// Event name mapping for different Facebook conventions
const EVENT_NAME_MAPPINGS = {
  'START_TRIAL': ['start_trial', 'start_trial_total', 'start_trial_website', 'offsite_conversion.fb_pixel_custom'],
  'PURCHASE': ['purchase', 'offsite_conversion.fb_pixel_purchase', 'web_in_store_purchase', 'onsite_web_purchase'],
  'LEAD': ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration', 'lead'],
  'APP_INSTALL': ['app_install', 'mobile_app_install'],
  'SUBSCRIPTION': ['subscribe', 'subscription', 'start_subscription'],
  'VIEW_CONTENT': ['view_content', 'offsite_conversion.fb_pixel_view_content'],
  'ADD_TO_CART': ['add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart'],
  'INITIATE_CHECKOUT': ['initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout']
};

function determineTargetEvent(adset) {
  // Step 2: Map Target Events by Adset
  if (adset.promoted_object && adset.promoted_object.custom_event_type) {
    return adset.promoted_object.custom_event_type; // e.g., "START_TRIAL"
  }
  
  // Map optimization goals to expected events
  const optimizationMapping = {
    'OFFSITE_CONVERSIONS': 'CUSTOM_EVENT', // Will need to check promoted_object
    'PURCHASES': 'PURCHASE',
    'LEADS': 'LEAD', 
    'APP_INSTALLS': 'APP_INSTALL',
    'LINK_CLICKS': 'LINK_CLICK',
    'LANDING_PAGE_VIEWS': 'LANDING_PAGE_VIEW',
    'POST_ENGAGEMENT': 'POST_ENGAGEMENT'
  };
  
  return optimizationMapping[adset.optimization_goal] || 'UNKNOWN';
}

function findEventInData(targetEvent, actionsData, conversionsData = null) {
  // Step 3: Universal Event Detection with Priority System
  
  // Priority 1: Check conversions field (higher fidelity)
  if (conversionsData && conversionsData.length > 0) {
    const conversionMatch = conversionsData.find(conv => 
      matchesEventType(targetEvent, conv.action_type)
    );
    if (conversionMatch) {
      return { source: 'conversions', data: conversionMatch, priority: 1 };
    }
  }
  
  // Priority 2: Check actions field (fallback)
  if (actionsData && actionsData.length > 0) {
    const actionMatch = actionsData.find(action => 
      matchesEventType(targetEvent, action.action_type)
    );
    if (actionMatch) {
      return { source: 'actions', data: actionMatch, priority: 2 };
    }
  }
  
  // Priority 3: No match found
  return { source: 'none', data: null, priority: 3 };
}

function matchesEventType(targetEvent, actualEventType) {
  // Step 4: Event Name Mapping
  
  // Direct match
  if (targetEvent === actualEventType) {
    return true;
  }
  
  // Check mapped variations
  const mappings = EVENT_NAME_MAPPINGS[targetEvent] || [];
  return mappings.some(mapping => 
    actualEventType.includes(mapping) || mapping.includes(actualEventType)
  );
}

async function fetchAdsetConfigurations(client, actId) {
  // Step 1: Get adset configuration
  try {
    const adsetsData = await client.makeRequest(`/${actId}/adsets`, {
      fields: 'name,optimization_goal,promoted_object,status',
      limit: 100 // Get active adsets
    });
    return adsetsData.data || [];
  } catch (error) {
    console.warn('Could not fetch adset configurations:', error.message);
    return [];
  }
}

export async function getAccountInsights(args) {
  try {
    // Validate input parameters
    const validatedArgs = validateParameters(ValidationSchemas.accountInsights, args);
    const { act_id, fields, level, ...otherParams } = validatedArgs;

    const client = new FacebookAPIClient();
    
    // Step 1: Query Performance Data + Configuration
    const insightsParams = {
      fields: fields.join(','),
      level: level || 'account', // Default to account level
      ...otherParams,
    };

    // Remove undefined/null values and format arrays
    Object.keys(insightsParams).forEach(key => {
      if (insightsParams[key] === undefined || insightsParams[key] === null) {
        delete insightsParams[key];
      } else if (Array.isArray(insightsParams[key])) {
        insightsParams[key] = insightsParams[key].join(',');
      }
    });

    // Get performance data
    const insightsData = await client.makeRequest(`/${act_id}/insights`, insightsParams);
    
    // Get adset configurations if we're analyzing events
    const includesActions = fields.includes('actions') || fields.includes('conversions');
    let adsetConfigs = [];
    if (includesActions) {
      adsetConfigs = await fetchAdsetConfigurations(client, act_id);
    }

    // Format response with universal event detection
    let responseText = '';
    
    if (insightsData.data && insightsData.data.length > 0) {
      responseText += await formatInsightsWithEventDetection(
        insightsData.data, 
        adsetConfigs, 
        level || 'account'
      );
      
      responseText += `\n\n**Raw API Response:**\n\`\`\`json\n${JSON.stringify(insightsData, null, 2)}\n\`\`\``;
    } else {
      responseText = `No insights data found.\n\n**Raw API Response:**\n\`\`\`json\n${JSON.stringify(insightsData, null, 2)}\n\`\`\``;
    }

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
    };
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function formatInsightsWithEventDetection(insightsData, adsetConfigs, level) {
  let responseText = '';
  
  if (level === 'adset' && adsetConfigs.length > 0) {
    // Adset-level analysis with configuration mapping
    responseText += `🎯 **Universal Event Detection Results:**\n\n`;
    
    insightsData.forEach((insight, index) => {
      const adsetConfig = adsetConfigs.find(config => 
        config.name === insight.adset_name || config.id === insight.adset_id
      );
      
      responseText += `**${index + 1}. ${insight.adset_name || 'Unknown Adset'}**\n`;
      
      if (adsetConfig) {
        const targetEvent = determineTargetEvent(adsetConfig);
        responseText += `   • Target Event: ${targetEvent}\n`;
        
        const eventResult = findEventInData(
          targetEvent, 
          insight.actions, 
          insight.conversions
        );
        
        if (eventResult.source !== 'none') {
          responseText += `   • ✅ **Found**: ${eventResult.data.action_type} = ${eventResult.data.value}\n`;
          responseText += `   • Source: ${eventResult.source} (Priority ${eventResult.priority})\n`;
        } else {
          responseText += `   • ⚠️ **Missing**: No ${targetEvent} events found in performance data\n`;
          responseText += `   • Status: Configured but not converting\n`;
        }
      } else {
        responseText += `   • ℹ️ Configuration not available\n`;
      }
      responseText += `\n`;
    });
  } else {
    // Account/Campaign level - show all available events
    const allInsights = insightsData[0]; // Usually single record for account level
    
    if (allInsights.actions && Array.isArray(allInsights.actions)) {
      responseText += `📊 **Available Conversion Events:**\n\n`;
      
      allInsights.actions.forEach((action, index) => {
        responseText += `${index + 1}. **${action.action_type}**\n`;
        responseText += `   • Volume: ${action.value}\n`;
        
        // Show which adsets target this event
        const targetingAdsets = adsetConfigs.filter(config => {
          const targetEvent = determineTargetEvent(config);
          return matchesEventType(targetEvent, action.action_type);
        });
        
        if (targetingAdsets.length > 0) {
          responseText += `   • 🎯 Targeted by: ${targetingAdsets.map(a => a.name).join(', ')}\n`;
        }
        
        responseText += `\n`;
      });
    }
    
    // Show configured but missing events
    if (adsetConfigs.length > 0) {
      const configuredEvents = new Set(adsetConfigs.map(config => determineTargetEvent(config)));
      const availableEvents = allInsights.actions ? 
        allInsights.actions.map(action => action.action_type) : [];
      
      const missingEvents = Array.from(configuredEvents).filter(targetEvent => {
        return !availableEvents.some(available => matchesEventType(targetEvent, available));
      });
      
      if (missingEvents.length > 0) {
        responseText += `\n⚠️ **Configured but Missing Events:**\n`;
        missingEvents.forEach(event => {
          const affectedAdsets = adsetConfigs.filter(config => 
            determineTargetEvent(config) === event
          );
          responseText += `• **${event}**: ${affectedAdsets.map(a => a.name).join(', ')}\n`;
        });
        responseText += `\nThese adsets are targeting events that aren't being tracked.\n`;
      }
    }
  }
  
  return responseText;
}