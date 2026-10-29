import '../src/config/env.js';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {z} from 'zod';

// Run with migration credentials only; never load them into the API process.
const email=z.email().parse(process.env.PLATFORM_ADMIN_EMAIL||'contato@bansir.com.br').toLowerCase();
const password=randomBytes(24).toString('base64url');
const client=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL,connectionTimeoutMillis:10000});
const prepare=process.argv.includes('--prepare');
if(!prepare&&!process.env.DATABASE_ADMIN_URL)throw new Error('Defina DATABASE_ADMIN_URL para provisionar ou use --prepare para preparar o primeiro acesso sem conexão.');
const output=new URL('../migration-private/painel-bansir-primeiro-acesso.txt',import.meta.url);
const quote=v=>`'${v.replaceAll("'","''")}'`;
try{
 const passwordHash=await bcrypt.hash(password,12);
 if(!prepare){await client.connect();await client.query('BEGIN');
 await client.query('INSERT INTO bansir.platform_admins(email,name,password_hash) VALUES($1,$2,$3)',[email,'Administrador Bansir',passwordHash]);}
 await mkdir(new URL('../migration-private/',import.meta.url),{recursive:true});
 if(prepare)await writeFile(new URL('../migration-private/painel-bansir-criar-admin.sql',import.meta.url),`-- Aplicar uma única vez após a migração 029, com a conexão administrativa.\nBEGIN;\nINSERT INTO bansir.platform_admins(email,name,password_hash) VALUES(${quote(email)},'Administrador Bansir',${quote(passwordHash)});\nCOMMIT;\n`,{flag:'wx',mode:0o600});
 await writeFile(output,`Estado: ${prepare?'PREPARADO; aplicar painel-bansir-criar-admin.sql para ativar a conta':'CRIADO no banco configurado'}\nPainel: /bansir-admin\nE-mail: ${email}\nSenha temporária: ${password}\nTroca obrigatória no primeiro acesso. Remova este arquivo após trocar a senha.\n`,{flag:'wx',mode:0o600});
 if(!prepare)await client.query('COMMIT');
 console.log(`${prepare?'Administrador preparado para ativação':'Administrador criado'}. Credenciais em migration-private/painel-bansir-primeiro-acesso.txt (fora do Git).`);
}catch(e){if(!prepare)await client.query('ROLLBACK').catch(()=>{});console.error('Provisionamento não concluído:',e.code||'Verifique a conexão e as migrações.');process.exitCode=1;}
finally{if(!prepare)await client.end();}
