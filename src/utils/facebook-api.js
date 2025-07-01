import axios from 'axios';
import { TokenStorage } from '../auth/token-storage.js';

export class FacebookAPIClient {
  constructor() {
    this.baseURL = process.env.FACEBOOK_BASE_URL || 'https://graph.facebook.com';
    this.version = process.env.FACEBOOK_API_VERSION || 'v23.0';
    this.accessToken = null;

    this.client = axios.create({
      baseURL: `${this.baseURL}/${this.version}`,
      timeout: 30000,
    });
  }

  async getAccessToken() {
    // Try stored token first
    const storedToken = await TokenStorage.getToken();
    if (storedToken) {
      this.accessToken = storedToken;
      return storedToken;
    }

    // Fall back to environment variable (for backward compatibility during transition)
    if (process.env.FACEBOOK_ACCESS_TOKEN) {
      this.accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
      return this.accessToken;
    }

    throw new Error('No Facebook access token available. Please run facebook_login to authenticate.');
  }

  async makeRequest(endpoint, params = {}) {
    try {
      // Ensure we have a valid token
      const accessToken = await this.getAccessToken();
      
      const response = await this.client.get(endpoint, {
        params: {
          access_token: accessToken,
          ...params,
        },
      });

      return response.data;
    } catch (error) {
      this.handleAPIError(error);
    }
  }

  async makeRequestFromFullURL(url) {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      this.handleAPIError(error);
    }
  }

  handleAPIError(error) {
    if (error.response?.data?.error) {
      const fbError = error.response.data.error;
      throw new Error(`Facebook API Error: ${fbError.message} (Code: ${fbError.code})`);
    }
    
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Facebook API took too long to respond');
    }

    throw new Error(`API Request failed: ${error.message}`);
  }
}