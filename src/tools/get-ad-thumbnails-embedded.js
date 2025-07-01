import { FacebookAPIClient } from '../utils/facebook-api.js';
import { ValidationSchemas, validateParameters } from '../utils/validation.js';
import { createErrorResponse } from '../utils/error-handler.js';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../../cache/images');

/**
 * Get ad thumbnails with embedded images and caching
 * Downloads, caches, and embeds images directly in the response
 */
export async function getAdThumbnailsEmbedded(args) {
  try {
    // Validate parameters
    const validatedArgs = validateParameters(ValidationSchemas.adThumbnailsEmbedded, args);
    const { 
      ad_ids, 
      resolution = 'all', 
      include_ad_details = true,
      cache_duration_hours = 24,
      max_image_size_mb = 5
    } = validatedArgs;

    const facebookAPI = new FacebookAPIClient();
    console.error(`🖼️ Fetching and embedding thumbnails for ${ad_ids.length} ads`);

    // Ensure cache directory exists
    await ensureCacheDir();

    const thumbnailResults = [];

    // Process ads in batches of 10 for efficiency (smaller batches for image processing)
    const batchSize = 10;
    for (let i = 0; i < ad_ids.length; i += batchSize) {
      const batch = ad_ids.slice(i, i + batchSize);
      console.error(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(ad_ids.length/batchSize)}`);

      // Use batch requests for efficiency
      const batchRequests = batch.map(adId => ({
        method: 'GET',
        relative_url: `${adId}?fields=name,creative{id,thumbnail_url,image_url,asset_feed_spec{images{hash}},object_story_spec{link_data{image_hash}}}`
      }));

      try {
        const batchResponse = await facebookAPI.makeBatchRequest(batchRequests);
        
        for (let j = 0; j < batch.length; j++) {
          const adId = batch[j];
          const result = batchResponse[j];
          
          if (result?.code === 200 && result.body) {
            const adData = JSON.parse(result.body);
            const thumbnailData = await processSingleAdThumbnailEmbedded(
              facebookAPI, 
              adData, 
              resolution, 
              include_ad_details,
              cache_duration_hours,
              max_image_size_mb
            );
            if (thumbnailData) {
              thumbnailResults.push(thumbnailData);
            }
          } else {
            console.error(`⚠️ Failed to get data for ad ${adId}: ${result?.code} ${result?.body}`);
            thumbnailResults.push({
              ad_id: adId,
              error: `Failed to fetch ad data (${result?.code})`
            });
          }
        }
      } catch (batchError) {
        console.error(`❌ Batch request failed, falling back to individual requests:`, batchError.message);
        
        // Fallback to individual requests
        for (const adId of batch) {
          try {
            const endpoint = `/${adId}`;
            const params = {
              fields: 'name,creative{id,thumbnail_url,image_url,asset_feed_spec{images{hash}},object_story_spec{link_data{image_hash}}}'
            };
            const adData = await facebookAPI.makeRequest(endpoint, 'GET', params);
            const thumbnailData = await processSingleAdThumbnailEmbedded(
              facebookAPI, 
              adData, 
              resolution, 
              include_ad_details,
              cache_duration_hours,
              max_image_size_mb
            );
            if (thumbnailData) {
              thumbnailResults.push(thumbnailData);
            }
          } catch (individualError) {
            console.error(`❌ Failed individual request for ad ${adId}:`, individualError.message);
            thumbnailResults.push({
              ad_id: adId,
              error: individualError.message
            });
          }
        }
      }
    }

    return {
      content: [{
        type: 'text',
        text: await formatEmbeddedThumbnailsResponse(thumbnailResults)
      }]
    };

  } catch (error) {
    console.error('Error in getAdThumbnailsEmbedded:', error);
    return createErrorResponse(error);
  }
}

/**
 * Process a single ad's thumbnail data with embedded images
 */
async function processSingleAdThumbnailEmbedded(facebookAPI, adData, resolution, includeDetails, cacheDurationHours, maxImageSizeMB) {
  try {
    const result = {
      ad_id: adData.id,
      ad_name: adData.name || 'Unknown Ad',
      thumbnails: [],
      creative_type: 'unknown',
      embedded_images: []
    };

    if (!adData.creative) {
      result.error = 'No creative data found';
      return result;
    }

    const creative = adData.creative;
    result.creative_id = creative.id;

    const imageUrls = [];

    // Method 1: Direct thumbnail_url (verified working)
    if (creative.thumbnail_url) {
      imageUrls.push({
        type: 'thumbnail',
        url: creative.thumbnail_url,
        source: 'direct_thumbnail'
      });
    }

    // Method 2: Direct image_url (verified working - full resolution)
    if (creative.image_url) {
      imageUrls.push({
        type: 'full_image',
        url: creative.image_url,
        source: 'direct_image'
      });
      result.creative_type = 'image';
    }

    // Method 3: Convert image hashes to URLs (verified working)
    const imageHashes = [];
    
    // Get hashes from asset_feed_spec.images
    if (creative.asset_feed_spec?.images) {
      creative.asset_feed_spec.images.forEach(img => {
        if (img.hash) imageHashes.push(img.hash);
      });
    }

    // Get hash from object_story_spec.link_data
    if (creative.object_story_spec?.link_data?.image_hash) {
      imageHashes.push(creative.object_story_spec.link_data.image_hash);
    }

    // Convert unique hashes to URLs
    const uniqueHashes = [...new Set(imageHashes)];
    for (const hash of uniqueHashes) {
      try {
        const hashUrl = await getImageUrlFromHash(facebookAPI, hash);
        if (hashUrl) {
          imageUrls.push({
            type: 'hash_converted',
            url: hashUrl,
            source: 'image_hash',
            hash: hash
          });
          if (result.creative_type === 'unknown') {
            result.creative_type = 'image';
          }
        }
      } catch (hashError) {
        console.error(`⚠️ Failed to convert hash ${hash}:`, hashError.message);
      }
    }

    // Filter by resolution preference
    let filteredUrls = imageUrls;
    if (resolution === 'thumbnail') {
      filteredUrls = imageUrls.filter(t => t.type === 'thumbnail');
    } else if (resolution === 'full') {
      filteredUrls = imageUrls.filter(t => t.type !== 'thumbnail');
    }

    // Download and embed images
    for (const imageInfo of filteredUrls) {
      try {
        const embeddedImage = await downloadAndEmbedImage(
          imageInfo.url, 
          imageInfo, 
          cacheDurationHours, 
          maxImageSizeMB
        );
        
        if (embeddedImage) {
          result.thumbnails.push(imageInfo);
          result.embedded_images.push(embeddedImage);
        }
      } catch (imageError) {
        console.error(`⚠️ Failed to embed image ${imageInfo.url}:`, imageError.message);
        // Still add the URL info even if embedding fails
        result.thumbnails.push({
          ...imageInfo,
          error: `Embedding failed: ${imageError.message}`
        });
      }
    }

    // Add additional details if requested
    if (includeDetails && creative.asset_feed_spec) {
      result.additional_info = {
        has_dynamic_creative: true,
        body_count: creative.asset_feed_spec.bodies?.length || 0,
        title_count: creative.asset_feed_spec.titles?.length || 0
      };
    }

    return result;

  } catch (error) {
    console.error(`Error processing ad ${adData.id}:`, error.message);
    return {
      ad_id: adData.id,
      ad_name: adData.name || 'Unknown Ad',
      error: error.message
    };
  }
}

/**
 * Download image and embed it as data URI with caching
 */
async function downloadAndEmbedImage(imageUrl, imageInfo, cacheDurationHours, maxImageSizeMB) {
  try {
    // Generate cache key based on URL (normalize to remove CDN variations)
    const normalizedUrl = imageUrl.replace(/scontent-[^.]+\./, 'scontent-xxx.').replace(/external-[^.]+\./, 'external-xxx.');
    const cacheKey = crypto.createHash('sha256').update(normalizedUrl + imageInfo.type).digest('hex');
    const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);

    // Check if cached version exists and is still valid
    try {
      const cacheStats = await fs.stat(cacheFile);
      const cacheAgeHours = (Date.now() - cacheStats.mtime.getTime()) / (1000 * 60 * 60);
      
      if (cacheAgeHours < cacheDurationHours) {
        console.error(`📋 Using cached image: ${imageInfo.type}`);
        const cachedData = await fs.readFile(cacheFile, 'utf8');
        return JSON.parse(cachedData);
      }
    } catch (cacheError) {
      // Cache file doesn't exist or is invalid, continue with download
    }

    console.error(`⬇️ Downloading image: ${imageInfo.type} from ${imageUrl.substring(0, 60)}...`);

    // Download image with size limit
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: maxImageSizeMB * 1024 * 1024, // Convert MB to bytes
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString('base64');
    
    // Determine MIME type from content-type header or URL extension
    let mimeType = response.headers['content-type'] || 'image/jpeg';
    
    // Fallback based on URL extension
    if (!mimeType.startsWith('image/')) {
      if (imageUrl.includes('.png')) mimeType = 'image/png';
      else if (imageUrl.includes('.gif')) mimeType = 'image/gif';
      else if (imageUrl.includes('.webp')) mimeType = 'image/webp';
      else mimeType = 'image/jpeg';
    }

    const embeddedImage = {
      type: imageInfo.type,
      source: imageInfo.source,
      data_uri: `data:${mimeType};base64,${base64}`,
      mime_type: mimeType,
      size_bytes: buffer.length,
      cached_at: new Date().toISOString(),
      original_url: imageUrl
    };

    // Cache the embedded image
    try {
      await fs.writeFile(cacheFile, JSON.stringify(embeddedImage, null, 2));
      console.error(`💾 Cached image: ${imageInfo.type} (${(buffer.length / 1024).toFixed(1)}KB)`);
    } catch (cacheWriteError) {
      console.error(`⚠️ Failed to cache image:`, cacheWriteError.message);
    }

    return embeddedImage;

  } catch (error) {
    console.error(`Error downloading/embedding image ${imageUrl}:`, error.message);
    throw error;
  }
}

/**
 * Convert image hash to full URL (reused from original implementation)
 */
async function getImageUrlFromHash(facebookAPI, imageHash) {
  try {
    let accountId = process.env.FACEBOOK_AD_ACCOUNT_ID;
    
    if (!accountId) {
      console.error('⚠️ No account ID available for hash conversion');
      return null;
    }

    accountId = accountId.replace('act_', '');
    
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
    console.error(`Error converting hash ${imageHash}:`, error.message);
    return null;
  }
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create cache directory:', error.message);
  }
}

/**
 * Format the embedded thumbnails response for display
 */
async function formatEmbeddedThumbnailsResponse(thumbnailResults) {
  if (thumbnailResults.length === 0) {
    return 'No thumbnail data found for the provided ad IDs.';
  }

  let response = `🖼️ **Ad Thumbnails Retrieved (Embedded)**\n\n`;
  response += `Found thumbnail data for ${thumbnailResults.length} ads:\n\n`;

  let totalImages = 0;
  let totalCacheHits = 0;
  let totalSizeKB = 0;

  for (const [index, result] of thumbnailResults.entries()) {
    response += `**${index + 1}. ${result.ad_name}**\n`;
    response += `• Ad ID: ${result.ad_id}\n`;
    
    if (result.creative_id) {
      response += `• Creative ID: ${result.creative_id}\n`;
    }
    
    if (result.error) {
      response += `• ❌ Error: ${result.error}\n`;
    } else {
      response += `• Type: ${result.creative_type}\n`;
      
      if (result.embedded_images && result.embedded_images.length > 0) {
        response += `• 🖼️ **Embedded Images (${result.embedded_images.length}):**\n`;
        
        for (const [imgIndex, img] of result.embedded_images.entries()) {
          const sizeKB = (img.size_bytes / 1024).toFixed(1);
          totalSizeKB += parseFloat(sizeKB);
          totalImages++;
          
          if (img.cached_at) {
            const cacheDate = new Date(img.cached_at);
            const now = new Date();
            const ageMinutes = Math.round((now - cacheDate) / (1000 * 60));
            
            if (ageMinutes < 60) {
              totalCacheHits++;
            }
          }
          
          response += `  ${imgIndex + 1}. **${img.type}** (${img.source})\n`;
          response += `     📊 Size: ${sizeKB}KB | Type: ${img.mime_type}\n`;
          response += `     🖼️ [Embedded Image Data URI - Ready for Display]\n`;
        }
      }
      
      if (result.additional_info) {
        const info = result.additional_info;
        response += `• 📝 Dynamic Creative: ${info.body_count} bodies, ${info.title_count} titles\n`;
      }
    }
    
    response += '\n';
  }

  response += `\n📊 **Processing Summary:**\n`;
  response += `• Total Images Embedded: ${totalImages}\n`;
  response += `• Total Size: ${totalSizeKB.toFixed(1)}KB\n`;
  response += `• Cache Hits: ${totalCacheHits}/${totalImages}\n`;
  response += `• Cache Directory: ./cache/images/\n`;

  response += `\n💡 **Benefits of Embedded Images:**\n`;
  response += `• ✅ **Instant Display** - Images are embedded directly in the response\n`;
  response += `• ✅ **Offline Capable** - No external URL dependencies\n`;
  response += `• ✅ **Cached** - Subsequent requests use cached data\n`;
  response += `• ✅ **Cross-Platform** - Works reliably across all LLM integrations\n`;

  return response;
}