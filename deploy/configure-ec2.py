#!/usr/bin/env python3
"""First-host setup, run as root after cloning and building the Docker image.
Secrets are generated on EC2 and never printed. Does not publish DNS or issue invoices.
"""
import base64,json,os,pathlib,secrets,subprocess

def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def sql(statement):run(['sudo','-u','postgres','psql','-v','ON_ERROR_STOP=1','-d','postgres'],input=statement,text=True,stdout=subprocess.DEVNULL)
def write(path,content,mode=0o600):
 p=pathlib.Path(path);p.write_text(content);p.chmod(mode)

if os.geteuid()!=0:raise SystemExit('Execute com sudo.')
root=pathlib.Path('/etc/bansir');root.mkdir(mode=0o700,exist_ok=True)
secret_file=root/'secrets.json'
if secret_file.exists():raise SystemExit('Host já inicializado; não sobrescrevemos segredos. Use o procedimento de atualização.')
values={name:secrets.token_hex(32) for name in ['api','notifications','fiscal','migration','jwt']}
values['encryption']=base64.b64encode(secrets.token_bytes(32)).decode()
values['vapid']=json.loads(subprocess.check_output(['docker','run','--rm','bansir-ultragas:local','node','-e',"console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"],text=True))
write(secret_file,json.dumps(values))
sql("CREATE DATABASE bansir;")
sql("CREATE ROLE bansir_migrator LOGIN SUPERUSER PASSWORD '"+values['migration']+"';")
admin=f"DATABASE_ADMIN_URL=postgresql://bansir_migrator:{values['migration']}@127.0.0.1:5432/bansir\n"
write(root/'admin.env',admin)
run(['docker','run','--rm','--network','host','--env-file',str(root/'admin.env'),'bansir-ultragas:local','node','scripts/migrate-postgres.js'])
for role,password,group in [('bansir_api',values['api'],'bansir_runtime'),('bansir_notifications',values['notifications'],'bansir_worker'),('bansir_fiscal',values['fiscal'],'bansir_worker')]:
 sql(f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '{password}'; GRANT {group} TO {role};")
sql('ALTER ROLE bansir_migrator NOLOGIN;')
gateway=json.loads(subprocess.check_output(['docker','network','inspect','bridge'],text=True))[0]['IPAM']['Config'][0]['Gateway']
config=pathlib.Path(subprocess.check_output(['sudo','-u','postgres','psql','-Atqc','SHOW config_file'],text=True).strip())
hba=pathlib.Path(subprocess.check_output(['sudo','-u','postgres','psql','-Atqc','SHOW hba_file'],text=True).strip())
write(config.parent/'conf.d'/'bansir.conf',f"listen_addresses = '127.0.0.1,{gateway}'\nshared_buffers = '256MB'\nmax_connections = 60\n",0o644)
with hba.open('a') as f:f.write('\n# Bansir isolated Docker network; database never binds the public interface.\nhost bansir bansir_api,bansir_notifications,bansir_fiscal 172.29.10.0/24 scram-sha-256\n')
run(['systemctl','restart','postgresql'])
deploy=pathlib.Path('/opt/bansir/backend/deploy')
vapid=f"VAPID_PUBLIC_KEY={values['vapid']['publicKey']}\nVAPID_PRIVATE_KEY={values['vapid']['privateKey']}\nVAPID_SUBJECT=mailto:admin@bansir.com.br\n"
common=f"FISCAL_ENCRYPTION_KEY={values['encryption']}\nFISCAL_PRODUCTION_ENABLED=false\n"
write(deploy/'api.env',f"DATABASE_URL=postgresql://bansir_api:{values['api']}@host.docker.internal:5432/bansir\nJWT_SECRET={values['jwt']}\nCORS_ORIGIN=https://gas.bansir.com.br\nTRUST_PROXY_HOPS=1\n"+common+vapid)
write(deploy/'notifications.env',f"WORKER_DATABASE_URL=postgresql://bansir_notifications:{values['notifications']}@host.docker.internal:5432/bansir\n"+vapid)
write(deploy/'fiscal.env',f"WORKER_DATABASE_URL=postgresql://bansir_fiscal:{values['fiscal']}@host.docker.internal:5432/bansir\n"+common+'AWS_REGION=sa-east-1\nFISCAL_S3_BUCKET=\nFISCAL_S3_KMS_KEY_ID=\n')
write(root/'compose.ec2.yml',"networks:\n  default:\n    ipam:\n      config:\n        - subnet: 172.29.10.0/24\n",0o644)
print('Banco, migrações, papéis e segredos configurados. Sem conta comercial pré-cadastrada. Worker fiscal aguarda bucket privado.')
