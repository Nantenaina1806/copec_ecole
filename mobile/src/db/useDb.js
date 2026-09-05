// Hook React mampiasa @capacitor-community/sqlite, ary manangana ny cursor sync
// isaky ny 15 segondra (mitovy fotoana amin'ny worker PC, jereo backend/src/services/
// syncService.js) SY isaky ny fiverenan'ny connection (Network.addListener).
//
// Ampiasaina toy izao ao amin'ny écran: const { db, syncNow, syncState } = useDb();

import { useCallback, useEffect, useRef, useState } from 'react';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Network } from '@capacitor/network';
import api from '../api/client';
import { getOrCreateDeviceId } from '../sync/deviceId';
import { synchroniser } from '../sync/syncClient';
import { createOfflineBridge } from '../offlineBridge';
import schemaSql from '../db/schema.sqlite.sql?raw';

const DB_NAME = 'copec_enseignant';
const SYNC_INTERVAL_MS = 15000;

let sqliteConnectionSingleton = null;
let databaseInitPromise = null;

async function initialiseDatabase() {
  if (!databaseInitPromise) {
    databaseInitPromise = (async () => {
      if (!sqliteConnectionSingleton) {
        sqliteConnectionSingleton = new SQLiteConnection(CapacitorSQLite);
      }
      const conn = await sqliteConnectionSingleton.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      await conn.open();
      for (const statement of schemaSql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await conn.execute(`${statement};`);
      }
      return conn;
    })();
  }
  return databaseInitPromise;
}

export function useDb() {
  const [db, setDb] = useState(null);
  const [syncState, setSyncState] = useState({ status: 'idle' });
  const deviceIdRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const conn = await initialiseDatabase();
        deviceIdRef.current = await getOrCreateDeviceId();
        if (!cancelled) setDb(conn);
      } catch (error) {
        console.error('Initialisation SQLite impossible :', error);
        if (!cancelled) setSyncState({ status: 'error', message: String(error) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const runSync = useCallback(async (currentDb) => {
    if (!currentDb || !deviceIdRef.current) return;
    const netStatus = await Network.getStatus();
    if (!netStatus.connected) {
      setSyncState({ status: 'offline' });
      return;
    }
    const result = await synchroniser(
      { run: (sql, params) => currentDb.run(sql, params), query: (sql, params) => currentDb.query(sql, params) },
      api,
      deviceIdRef.current,
    );
    setSyncState(result.error ? { status: 'error', message: String(result.error) } : { status: 'idle', ...result });
  }, []);

  useEffect(() => {
    if (!db) return undefined;
    if (typeof window !== 'undefined') window.__COPEC_MOBILE_OFFLINE__ = createOfflineBridge(db, () => runSync(db));
    runSync(db);
    intervalRef.current = setInterval(() => runSync(db), SYNC_INTERVAL_MS);
    const netHandle = Network.addListener('networkStatusChange', (status) => {
      if (status.connected) runSync(db);
    });
    return () => {
      clearInterval(intervalRef.current);
      netHandle.remove();
      if (typeof window !== 'undefined') delete window.__COPEC_MOBILE_OFFLINE__;
    };
  }, [db]);

  const syncNow = useCallback(() => runSync(db), [db, runSync]);
  return { db, syncNow, syncState };
}
