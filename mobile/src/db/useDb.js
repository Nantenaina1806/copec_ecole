// Hook React mampiasa @capacitor-community/sqlite, ary manangana ny cursor sync
// isaky ny 15 segondra (mitovy fotoana amin'ny worker PC, jereo backend/src/services/
// syncService.js) SY isaky ny fiverenan'ny connection (Network.addListener).
//
// Ampiasaina toy izao ao amin'ny écran: const { db, syncNow, syncState } = useDb();

import { useEffect, useRef, useState } from 'react';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Network } from '@capacitor/network';
import api from '../api/client';
import { getOrCreateDeviceId } from '../sync/deviceId';
import { synchroniser } from '../sync/syncClient';
import schemaSql from '../db/schema.sqlite.sql?raw';

const DB_NAME = 'copec_enseignant';
const SYNC_INTERVAL_MS = 15000;

let sqliteConnectionSingleton = null;

export function useDb() {
  const [db, setDb] = useState(null);
  const [syncState, setSyncState] = useState({ status: 'idle' });
  const deviceIdRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sqliteConnectionSingleton) {
        sqliteConnectionSingleton = new SQLiteConnection(CapacitorSQLite);
      }
      const conn = await sqliteConnectionSingleton.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      await conn.open();
      // Miditra tsikelikely (schema.sqlite.sql dia misy "CREATE TABLE IF NOT EXISTS"
      // isaky ny tabilao, ka azo antoka ny mamerina manao azy isaky ny fanombohana).
      for (const statement of schemaSql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await conn.execute(`${statement};`);
      }
      deviceIdRef.current = await getOrCreateDeviceId();
      if (!cancelled) setDb(conn);
    })();
    return () => { cancelled = true; };
  }, []);

  const runSync = async (currentDb) => {
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
  };

  useEffect(() => {
    if (!db) return undefined;
    runSync(db);
    intervalRef.current = setInterval(() => runSync(db), SYNC_INTERVAL_MS);
    const netHandle = Network.addListener('networkStatusChange', (status) => {
      if (status.connected) runSync(db);
    });
    return () => {
      clearInterval(intervalRef.current);
      netHandle.remove();
    };
  }, [db]);

  return { db, syncNow: () => runSync(db), syncState };
}
