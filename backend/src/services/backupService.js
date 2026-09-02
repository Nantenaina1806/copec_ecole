'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { query } = require('../config/db');
const execFileAsync = promisify(execFile);
const BACKUP_DIR = path.resolve(process.env.COPEC_BACKUP_DIR || path.join(process.cwd(), 'backups'));

function dbEnv() { const url=process.env.DATABASE_URL; return url ? {url} : {host:process.env.PGHOST,port:process.env.PGPORT||'5432',user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE}; }
async function checksum(file) { return new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');const s=fs.createReadStream(file);s.on('error',reject);s.on('data',d=>h.update(d));s.on('end',()=>resolve(h.digest('hex')));}); }
async function createBackup({ utilisateurId=null, agentId=null }={}) {
  fs.mkdirSync(BACKUP_DIR,{recursive:true}); const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const filename=`copec-backup-${stamp}.sql`; const filepath=path.join(BACKUP_DIR,filename); const d=dbEnv(); const env={...process.env}; if(!d.url&&d.password)env.PGPASSWORD=d.password;
  const args=d.url?[d.url,'--no-owner','--no-privileges','--file',filepath]:['--no-owner','--no-privileges','--file',filepath,'--host',d.host,'--port',String(d.port),'--username',d.user,'--dbname',d.database];
  try { await execFileAsync('pg_dump',args,{env,timeout:120000,windowsHide:true}); const stat=fs.statSync(filepath); const sha=await checksum(filepath); const {rows}=await query(`INSERT INTO system_backup(filename,filepath,size_bytes,checksum_sha256,created_by_utilisateur_id,created_by_agent_id,status) VALUES($1,$2,$3,$4,$5,$6,'success') RETURNING *`,[filename,filepath,stat.size,sha,utilisateurId,agentId]); return rows[0]; }
  catch(e){ try{if(fs.existsSync(filepath))fs.unlinkSync(filepath);}catch{} await query(`INSERT INTO system_backup(filename,filepath,status,error,created_by_utilisateur_id,created_by_agent_id) VALUES($1,$2,'failed',$3,$4,$5)`,[filename,filepath,e.message,utilisateurId,agentId]).catch(()=>{}); throw e; }
}
async function purgeOldBackups() { const retention=Math.max(1,Number(process.env.BACKUP_RETENTION_DAYS||30)); const {rows}=await query(`SELECT id,filepath FROM system_backup WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,[retention]); let deleted=0; for(const r of rows){try{if(fs.existsSync(r.filepath))fs.unlinkSync(r.filepath);}catch{} await query('DELETE FROM system_backup WHERE id=$1',[r.id]); deleted++;} return deleted; }
module.exports={createBackup,purgeOldBackups,BACKUP_DIR};
