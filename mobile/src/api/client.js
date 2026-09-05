// Client API ho an'ny appli mobile — mitovy filozofia amin'ny frontend/src/api/client.js
// (PC) fa ny baseURL eto dia tsy maintsy ilay backend Internet (mobile/.env, VITE_API_URL
// na endriny mitovy), tsy 127.0.0.1 intsony satria tsy misy Node local ao anaty téléphone.

import axios from 'axios';
import { Preferences } from '@capacitor/preferences';

const BASE_URL = import.meta.env.VITE_MOBILE_API_URL || import.meta.env.VITE_API_URL || '/api';

const client = axios.create({ baseURL: BASE_URL, timeout: 15000 });

client.interceptors.request.use(async (config) => {
  const { value: token } = await Preferences.get({ key: 'copec_mobile_token' });
  const browserToken = typeof localStorage !== 'undefined' ? localStorage.getItem('copec_token') : null;
  if (token || browserToken) config.headers.Authorization = `Bearer ${token || browserToken}`;
  return config;
});

export function apiErrorMessage(err) {
  return err?.response?.data?.error || err?.message || 'Hadisoana tsy fantatra.';
}

export default client;
