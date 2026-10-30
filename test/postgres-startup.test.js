import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('startup rejects MongoDB explicitly and requires PostgreSQL without opening a listener',()=>{
 for(const engine of ['mongodb','invalid','postgres','']){
  const result=spawnSync(process.execPath,['src/server.js'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:5000,env:{...process.env,DATABASE_ENGINE:engine,DATABASE_URL:'',MONGODB_URI:'mongodb://127.0.0.1:1/unused'}});
  assert.equal(result.status,1);
  assert.match(result.stderr,engine&&engine!=='postgres'?/somente PostgreSQL/:/DATABASE_URL/);
  assert.doesNotMatch(result.stderr,/Mongoose|ECONNREFUSED|MongoServer/);
 }
});
