import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

const client = axios.create({ baseURL, withCredentials: true });

function mobileOfflineBridge() {
  return typeof window !== 'undefined' ? window.__COPEC_MOBILE_OFFLINE__ : null;
}

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('copec_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const bridge = mobileOfflineBridge();
  if (bridge?.requestOffline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    const error = new Error('offline');
    error.config = config;
    error.__mobileOffline = true;
    return Promise.reject(error);
  }
  return config;
});

client.interceptors.response.use(
  async (res) => {
    const bridge = mobileOfflineBridge();
    if (bridge?.cacheResponse) await bridge.cacheResponse(res.config, res.data);
    return res;
  },
  (err) => {
    const bridge = mobileOfflineBridge();
    if (bridge?.requestOffline && (!err.response || typeof navigator === 'undefined' || !navigator.onLine)) {
      return bridge.requestOffline(err.config).then((data) => ({
        config: err.config,
        data,
        status: 200,
        statusText: 'OK (offline)',
        headers: {},
      }));
    }
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      localStorage.removeItem('copec_token');
      localStorage.removeItem('copec_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export function apiErrorMessage(err) {
  return err?.response?.data?.error || err?.message || 'Une erreur est survenue.';
}

export default client;
