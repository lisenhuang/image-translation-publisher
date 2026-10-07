import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

test('parallel processes initialise a fresh SQLite database without lock failures',async()=>{
  for(let round=0;round<3;round++){
    const dir=mkdtempSync(path.join(tmpdir(),'gallery-startup-'));
    try{
      const start=Date.now()+1000;
      const results=await Promise.all(Array.from({length:8},()=>new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['--input-type=module','-e',`
          const delay=Number(process.env.START_AT)-Date.now();
          if(delay>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delay);
          const {db}=await import('./lib/db.mjs');
          if(db.pragma('journal_mode',{simple:true})!=='wal')throw Error('WAL not enabled');
          db.prepare('SELECT COUNT(*) FROM storage_alerts').get();
          db.close();
        `],{env:{...process.env,DATA_DIR:dir,START_AT:String(start)},stdio:['ignore','ignore','pipe']});
        let errors='';child.stderr.on('data',chunk=>{errors+=chunk;});
        child.on('error',reject);
        child.on('close',code=>resolve({code,errors}));
      })));
      for(const result of results)assert.equal(result.code,0,result.errors);
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});
