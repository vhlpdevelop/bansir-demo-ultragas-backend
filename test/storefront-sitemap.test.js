import test from 'node:test';
import assert from 'node:assert/strict';
import {publicStorefrontSitemap} from '../src/postgres/storefront.js';

test('publicStorefrontSitemap enforces READ ONLY, bansir_storefront role, orderLink contract feature and strict slug validation',async()=>{
 const queries=[];
 let released=false;
 const database={
  pool:{
   async connect(){
    return {
     async query(sql,params=[]){
      queries.push({sql,params});
      if(sql.startsWith('SELECT tenant_id,slug,updated_at'))return {
       rows:[
        {tenant_id:'11111111-1111-4111-8111-111111111111',slug:'loja-ativa',updated_at:'2026-11-09T12:34:56.789Z'},
        {tenant_id:'22222222-2222-4222-8222-222222222222',slug:'loja-bloqueada',updated_at:'2026-11-09T12:34:56.789Z'},
        {tenant_id:'11111111-1111-4111-8111-111111111111',slug:'<invalid-xml>',updated_at:'2026-11-09T12:34:56.789Z'}
       ]
      };
      if(sql.startsWith('SELECT bansir.tenant_features()')){
       const lastTenant=queries.filter(q=>q.sql.includes("set_config('app.tenant_id'")).at(-1)?.params[0];
       return {rows:[{f:{orderLink:lastTenant==='11111111-1111-4111-8111-111111111111'}}]};
      }
      return {rows:[]};
     },
     release(){released=true;}
    };
   }
  }
 };
 const xml=await publicStorefrontSitemap(database,{baseUrl:'https://gas.bansir.com.br/'});
 assert.equal(released,true);
 assert.equal(queries[0].sql,'BEGIN READ ONLY');
 assert.equal(queries[1].sql,'SET LOCAL ROLE bansir_storefront');
 assert.equal(queries.at(-1).sql,'COMMIT');
 assert.match(xml,/<loc>https:\/\/gas\.bansir\.com\.br\/pedir\/loja-ativa<\/loc>/);
 assert.match(xml,/<lastmod>2026-11-09<\/lastmod>/);
 assert.doesNotMatch(xml,/loja-bloqueada/);
 assert.doesNotMatch(xml,/invalid-xml/);
 assert.doesNotMatch(xml,/11111111-1111-4111-8111-111111111111/);
 assert.doesNotMatch(xml,/12:34:56/);
});

