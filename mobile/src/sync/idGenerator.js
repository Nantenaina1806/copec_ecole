// Ny id an'ny rakitra (note, pointage_eleve, ...) noforonina eto an-toerana (offline)
// dia TSY azo avela ho toy ny "1, 2, 3..." tsotra, satria raha téléphone maro no
// samy manoratra tsy misy connection, dia hifanindry (collision) ny id rehefa
// mifanome vaovao amin'ny backend afovoany avy eo.
//
// Vahaolana ampiasaina eto: id = epochMillis * 1000 + isa kisendrasendra (0-999).
//   * epochMillis (~13 tarehimarika ankehitriny) * 1000 = ~1.79e15 -> mbola ao
//     anatin'ny Number.MAX_SAFE_INTEGER (9.007e15) any JavaScript, ary ao anatin'ny
//     BIGINT PostgreSQL (max ~9.2e18) any amin'ny backend.
//   * Ny fifanindriana dia mila hitranga amin'ny milliseconde mitovy TSARA (rehefa
//     tsy misy connection ihany koa) SY amin'ny isa kisendrasendra mitovy — tena
//     mahalana amin'ny fampiasana andavanandro ao amin'ny sekoly iray.
//   * Na dia mitranga aza izany indraindray (tena mahalana), tsy very ny angona:
//     ny backend (applyChange, syncService.js) dia mamorona "sync_conflict" fa tsy
//     mandika ny efa misy, ka ho hitan'ny admin ao amin'ny fitantanana conflits.

export function generateLocalId() {
  const millis = Date.now();
  const jitter = Math.floor(Math.random() * 1000);
  return millis * 1000 + jitter;
}
