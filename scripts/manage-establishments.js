import '../src/config/env.js';
import {assignPlan,createEstablishment,assignEstablishmentOwner} from '../src/postgres/provision.js';
try {
  const action=process.argv[2];
  let result;
  if (action==='plan') result=await assignPlan(process.env.DATABASE_ADMIN_URL,{
    tenantSlug:process.env.MANAGE_TENANT_SLUG,code:process.env.MANAGE_PLAN_CODE,name:process.env.MANAGE_PLAN_NAME,
    maxEstablishments:Number(process.env.MANAGE_PLAN_MAX_ESTABLISHMENTS)
  });
  else if(action==='create') result=await createEstablishment(process.env.DATABASE_ADMIN_URL,{
    tenantSlug:process.env.MANAGE_TENANT_SLUG,name:process.env.MANAGE_ESTABLISHMENT_NAME,documentId:process.env.MANAGE_ESTABLISHMENT_DOCUMENT || '',
    memberships:JSON.parse(process.env.MANAGE_ESTABLISHMENT_MEMBERSHIPS || '')
  });
  else if(action==='owner')result=await assignEstablishmentOwner(process.env.DATABASE_ADMIN_URL,{tenantSlug:process.env.MANAGE_TENANT_SLUG,establishmentId:process.env.MANAGE_ESTABLISHMENT_ID,userId:process.env.MANAGE_OWNER_USER_ID});
  else throw new Error('Ação inválida.');
  console.log(JSON.stringify(result));
} catch {console.error('Operação não concluída. Confira plano, limite de estabelecimentos e vínculos com a empresa.');process.exitCode=1;}
