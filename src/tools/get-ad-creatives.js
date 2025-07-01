import { FacebookAPIClient } from '../utils/facebook-api.js';
import { validateParameters } from '../utils/validation.js';
import { createErrorResponse } from '../utils/error-handler.js';

/**
 * Get ad creatives with thumbnails and performance metrics
 * Adapted from the AdSetVideoDownloader patterns
 */
export async function getAdCreatives(args) {
  try {
    // Validate required parameters
    const validatedArgs = validateParameters(args, [
      { name: 'act_id', type: 'string', required: true }
    ]);

    const {
      act_id,
      min_purchase_events = 10,
      max_cost_per_purchase = 50,
      include_images = true,
      date_range_days = 730, // ~2 years like your script
      limit = 50
    } = validatedArgs;

    const facebookAPI = new FacebookAPIClient();

    // Calculate date range (adapted from your script)
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - (date_range_days * 24 * 60 * 60 * 1000))
      .toISOString().split('T')[0];

    console.error(`🎯 Fetching creatives for account ${act_id} (${startDate} to ${endDate})`);

    // Step 1: Get ads with performance data and creatives (adapted from your get_ads_from_account)
    const adsWithCreatives = await getAdsWithCreatives(
      facebookAPI, 
      act_id, 
      startDate, 
      endDate, 
      min_purchase_events, 
      max_cost_per_purchase,
      limit
    );

    console.error(`📊 Found ${adsWithCreatives.length} high-performing ads`);

    if (adsWithCreatives.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No high-performing ads found in account ${act_id} with criteria:\n• Min purchase events: ${min_purchase_events}\n• Max cost per purchase: $${max_cost_per_purchase}`
        }]
      };
    }

    // Step 2: Get creative details in batches (adapted from your get_creative_details_batch)
    const creativeIds = adsWithCreatives.map(ad => ad.creative.id);
    const creativeDetails = await getCreativeDetailsBatch(facebookAPI, creativeIds);

    // Step 3: Process creatives and get image URLs (adapted from your image processing)
    const creativesWithThumbnails = [];
    
    for (const ad of adsWithCreatives) {
      const creativeId = ad.creative.id;
      const details = creativeDetails[creativeId];
      
      if (!details) continue;

      const creativeData = {
        creative_id: creativeId,
        ad_id: ad.id,
        ad_name: ad.name,
        creative_type: 'unknown',
        thumbnail_url: null,
        performance_metrics: {
          spend: ad.spend,
          fb_mobile_purchase_count: ad.fb_mobile_purchase_count,
          cost_per_purchase: ad.cost_per_purchase,
          impressions: ad.impressions || 0,
          clicks: ad.clicks || 0,
          ctr: ad.ctr || 0
        }
      };

      // Get thumbnail URL (adapted from your image hash conversion)
      if (include_images) {
        const thumbnailUrl = await getThumbnailUrl(facebookAPI, act_id, details);
        if (thumbnailUrl) {
          creativeData.thumbnail_url = thumbnailUrl;
          creativeData.creative_type = 'image';
        }
      }

      // Check for video content (adapted from your video detection logic)
      if (hasVideoContent(details)) {
        creativeData.creative_type = creativeData.creative_type === 'image' ? 'carousel' : 'video';
      }

      creativesWithThumbnails.push(creativeData);
    }

    // Step 4: Sort by performance (best cost per purchase first)
    creativesWithThumbnails.sort((a, b) => a.performance_metrics.cost_per_purchase - b.performance_metrics.cost_per_purchase);

    return {
      content: [{
        type: 'text',
        text: formatCreativesResponse(creativesWithThumbnails, act_id)
      }]
    };

  } catch (error) {
    console.error('Error in getAdCreatives:', error);
    return createErrorResponse(error);
  }
}

/**
 * Get ads with performance data and creatives (adapted from your get_ads_from_account)
 */
async function getAdsWithCreatives(facebookAPI, actId, startDate, endDate, minPurchaseEvents, maxCostPerPurchase, limit) {
  const endpoint = `/${actId}/ads`;
  const params = {
    fields: `id,name,insights.time_range({since:'${startDate}',until:'${endDate}'}){actions,spend,impressions,clicks,ctr},creative{id,effective_object_story_id,asset_feed_spec,object_story_spec,thumbnail_url,image_url}`,
    limit: limit
  };

  let allAds = [];
  let response = await facebookAPI.makeRequest(endpoint, 'GET', params);

  while (response.data) {
    for (const adData of response.data) {
      if (!adData.creative) continue;

      let fbMobilePurchaseCount = 0;
      let spend = 0;
      let impressions = 0;
      let clicks = 0;
      let ctr = 0;

      // Extract insights data (adapted from your insights processing)
      if (adData.insights?.data?.[0]) {
        const insights = adData.insights.data[0];
        spend = parseFloat(insights.spend || 0);
        impressions = parseInt(insights.impressions || 0);
        clicks = parseInt(insights.clicks || 0);
        ctr = parseFloat(insights.ctr || 0);

        if (insights.actions) {
          for (const action of insights.actions) {
            if (action.action_type === 'app_custom_event.fb_mobile_purchase') {
              fbMobilePurchaseCount = parseFloat(action.value);
              break;
            }
          }
        }
      }

      // Apply your filtering criteria
      if (fbMobilePurchaseCount >= minPurchaseEvents) {
        const costPerPurchase = fbMobilePurchaseCount > 0 ? spend / fbMobilePurchaseCount : Infinity;
        if (costPerPurchase <= maxCostPerPurchase) {
          allAds.push({
            id: adData.id,
            name: adData.name || '',
            creative: adData.creative,
            spend,
            fb_mobile_purchase_count: fbMobilePurchaseCount,
            cost_per_purchase: costPerPurchase,
            impressions,
            clicks,
            ctr
          });
        }
      }
    }

    // Handle pagination
    if (response.paging?.next) {
      response = await facebookAPI.makeRequestFromFullURL(response.paging.next);
    } else {
      break;
    }
  }

  return allAds;
}

/**
 * Get creative details in batches (adapted from your get_creative_details_batch)
 */
async function getCreativeDetailsBatch(facebookAPI, creativeIds) {
  const batchSize = 50;
  const results = {};

  for (let i = 0; i < creativeIds.length; i += batchSize) {
    const batch = creativeIds.slice(i, i + batchSize);
    
    try {
      // Use Facebook's batch API
      const batchRequests = batch.map(creativeId => ({
        method: 'GET',
        relative_url: `${creativeId}?fields=effective_object_story_id,asset_feed_spec,object_type,object_story_spec,effective_instagram_story_id,thumbnail_url,image_url`
      }));

      const batchResponse = await facebookAPI.makeBatchRequest(batchRequests);
      
      for (let j = 0; j < batch.length; j++) {
        const creativeId = batch[j];
        const result = batchResponse[j];
        
        if (result?.code === 200 && result.body) {
          results[creativeId] = JSON.parse(result.body);
        }
      }
    } catch (error) {
      console.error(`Batch request failed for creatives ${i}-${i + batchSize - 1}:`, error);
      
      // Fallback to individual requests
      for (const creativeId of batch) {
        try {
          const endpoint = `/${creativeId}`;
          const params = {
            fields: 'effective_object_story_id,asset_feed_spec,object_type,object_story_spec,effective_instagram_story_id,thumbnail_url,image_url'
          };
          const individual = await facebookAPI.makeRequest(endpoint, 'GET', params);
          results[creativeId] = individual;
        } catch (individualError) {
          console.error(`Failed to get creative ${creativeId}:`, individualError);
        }
      }
    }
  }

  return results;
}

/**
 * Get thumbnail URL (adapted from your get_image_url_from_hash)
 */
async function getThumbnailUrl(facebookAPI, actId, creativeDetails) {
  try {
    // Method 1: Direct thumbnail_url from creative
    if (creativeDetails.thumbnail_url) {
      return creativeDetails.thumbnail_url;
    }

    // Method 2: Direct image_url from creative
    if (creativeDetails.image_url) {
      return creativeDetails.image_url;
    }

    // Method 3: Get from asset_feed_spec images (adapted from your hash method)
    if (creativeDetails.asset_feed_spec?.images?.[0]?.hash) {
      const imageHash = creativeDetails.asset_feed_spec.images[0].hash;
      return await getImageUrlFromHash(facebookAPI, actId, imageHash);
    }

    return null;
  } catch (error) {
    console.error('Error getting thumbnail URL:', error);
    return null;
  }
}

/**
 * Get image URL from hash (adapted from your get_image_url_from_hash)
 */
async function getImageUrlFromHash(facebookAPI, actId, imageHash) {
  try {
    // Remove 'act_' prefix if it exists
    const accountId = actId.replace('act_', '');
    const endpoint = `/act_${accountId}/adimages`;
    const params = {
      hashes: JSON.stringify([imageHash]),
      fields: 'hash,url,permalink_url'
    };

    const response = await facebookAPI.makeRequest(endpoint, 'GET', params);
    
    if (response.data?.[0]?.url) {
      return response.data[0].url;
    }

    return null;
  } catch (error) {
    console.error('Error getting image URL from hash:', error);
    return null;
  }
}

/**
 * Check if creative has video content (adapted from your video detection)
 */
function hasVideoContent(creativeDetails) {
  // Check for videos in asset_feed_spec
  if (creativeDetails.asset_feed_spec?.videos?.length > 0) {
    return true;
  }

  // Check for video in object_story_spec
  if (creativeDetails.object_story_spec?.video_data) {
    return true;
  }

  // Check for effective_object_story_id (often indicates video)
  if (creativeDetails.effective_object_story_id) {
    return true;
  }

  return false;
}

/**
 * Format the response for display
 */
function formatCreativesResponse(creatives, actId) {
  if (creatives.length === 0) {
    return `No high-performing ad creatives found for account ${actId}.`;
  }

  let response = `🎯 **High-Performing Ad Creatives for Account ${actId}**\n\n`;
  response += `Found ${creatives.length} creatives with strong performance:\n\n`;

  creatives.forEach((creative, index) => {
    const metrics = creative.performance_metrics;
    response += `**${index + 1}. ${creative.ad_name}**\n`;
    response += `• Creative ID: ${creative.creative_id}\n`;
    response += `• Type: ${creative.creative_type}\n`;
    response += `• Cost per Purchase: $${metrics.cost_per_purchase.toFixed(2)}\n`;
    response += `• Purchases: ${metrics.fb_mobile_purchase_count}\n`;
    response += `• Spend: $${metrics.spend.toFixed(2)}\n`;
    
    if (metrics.impressions > 0) {
      response += `• CTR: ${metrics.ctr.toFixed(2)}%\n`;
    }
    
    if (creative.thumbnail_url) {
      response += `• 🖼️ **Thumbnail**: ${creative.thumbnail_url}\n`;
    }
    
    response += '\n';
  });

  response += `\n💡 **Tips**: These creatives have the best cost per purchase ratios. Consider using similar visual elements and messaging in new campaigns.`;

  return response;
}