// Deviceid tokana ho an'ity fanapetrahana ity, jenerémina indray mandeha ihany
// ary tehirizina eto an-toerana (Preferences). Ny endriny "MOBILE-<uuid>" dia
// ilaina satria ny backend (syncMobile.js, isValidDeviceId) manaraka io endriny io
// ihany.
//
// Adaptateur: eto dia mampiasa @capacitor/preferences (fototra Capacitor, tsy
// mila package fanampiny). Raha PWA fotsiny no atao (tsy Capacitor), soloy amin'ny
// localStorage.

import { Preferences } from '@capacitor/preferences';

const KEY = 'copec_mobile_device_id';

function randomUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Reny raha tsy misy crypto.randomUUID (webview tranainy)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId() {
  const existing = await Preferences.get({ key: KEY });
  if (existing.value) return existing.value;
  const id = `MOBILE-${randomUuid()}`;
  await Preferences.set({ key: KEY, value: id });
  return id;
}
