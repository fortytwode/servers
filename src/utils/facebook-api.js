import axios from 'axios';

export class FacebookAPIClient {
  constructor() {
    this.baseURL = process.env.FACEBOOK_BASE_URL || 'https://graph.facebook.com';
    this.version = process.env.FACEBOOK_API_VERSION || 'v18.0';
    this.accessToken = process.env.FACEBOOK_ACCESS_TOKEN;

    if (!this.accessToken) {
      throw new Error('FACEBOOK_ACCESS_TOKEN environment variable is required');
    }

    this.client = axios.create({
      baseURL: `${this.baseURL}/${this.version}`,
      timeout: 30000,
    });
  }

  async makeRequest(endpoint, params = {}) {
    try {
      const response = await this.client.get(endpoint, {
        params: {
          access_token: this.accessToken,
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