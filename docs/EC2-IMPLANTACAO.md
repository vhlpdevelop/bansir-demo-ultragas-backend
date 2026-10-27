# EC2 Bansir Gás: implantação inicial

Em 27/10/2026: Ubuntu 26.04.1 LTS, x86_64, aproximadamente 4 GB de RAM e disco raiz de 28 GB. PostgreSQL 18 no host; API e notificações no Docker. Backend e app clonados do GitHub em `/opt/bansir/backend` e `/opt/bansir/app`. Não houve importação de clientes reais nem criação de senha padrão.

## Configuração inicial

O script `deploy/configure-ec2.py` é exclusivo para host novo, executado como root depois do build. Não deve ser executado novamente em um banco existente. Cria banco, aplica migrações 001–010, gera JWT, chave fiscal e VAPID no servidor e cria logins distintos de API/notificações/fiscal. Segredos ficam em `/etc/bansir/secrets.json`, `/etc/bansir/admin.env` e nos arquivos `deploy/*.env` do checkout remoto, com permissão 600. Nunca copiá-los para Git, chat ou frontend. Fazer cópia segura da chave fiscal junto ao plano de recuperação: sem ela, certificados/CSC criptografados ficam ilegíveis.

O PostgreSQL escuta somente em localhost e no gateway Docker; o HBA autoriza apenas os três logins na rede Docker isolada `172.29.10.0/24`. A API publica porta 5000 somente em localhost. O papel administrativo de migrações tem LOGIN desativado após o setup. Não conceder sua associação à API ou workers.

O serviço `bansir-stack.service` inicia API e notificações no boot. Comandos de operação:

```sh
cd /opt/bansir/backend
sudo docker compose -f compose.production.yml -f /etc/bansir/compose.ec2.yml ps
curl -fsS http://127.0.0.1:5000/api/health
sudo docker compose -f compose.production.yml -f /etc/bansir/compose.ec2.yml logs --tail 50 api notifications
```

O worker fiscal está preparado, mas não é iniciado enquanto `FISCAL_S3_BUCKET` estiver vazio. Após criar o bucket privado e o IAM role, preencher o env e iniciar `fiscal`. Emissão real continua bloqueada por `FISCAL_PRODUCTION_ENABLED=false`; depende do certificado, cadastro/tributação/CSC da loja e homologação. A conta comercial inicial deve ser provisionada com os dados reais do responsável antes do uso.

Backup local diário via `bansir-db-backup.timer`, às 03h de Cuiabá, com atraso aleatório de até cinco minutos e retenção de 14 dias em `/var/backups/bansir`. Dump é privado e não inclui segredos da aplicação nem senhas dos papéis. Isso ainda NÃO é backup externo: faltam S3/versionamento/retencão, cópia segura dos segredos e rotina de teste de restauração. O disco da EC2 é um ponto único de falha.

## GitHub e atualização

O backend é clonado por HTTPS público; o app privado usa chave de deploy somente leitura, exclusiva da EC2. Não há token pessoal do GitHub instalado no servidor.

Antes de atualização, gerar backup, ler migrações novas e registrar os SHAs em execução. Fazer `git pull --ff-only` nos checkouts e reconstruir a imagem. Aplicar migrações novas separadamente com o acesso administrativo local, habilitado apenas durante a manutenção. Não rodar novamente o script de primeira instalação. O grupo de migração não pode estar no ambiente permanente dos containers. Recriar API/workers após a migração e verificar saúde/logs.

## Próxima etapa: S3, CloudFront, domínio e HTTPS

Nomes planejados, ainda sem alteração no DNS: `gas.bansir.com.br` para o app e `api-gas.bansir.com.br` para a API. Podemos manter o DNS atual do domínio; Route 53 é opcional. CloudFront distribui o app e não substitui o DNS.

1. Associar um **Elastic IP** à EC2 para o endereço da API permanecer estável. Depois, criar registro A `api-gas` apontando a esse Elastic IP no DNS atual. Não substituir os registros do domínio principal ou de e-mail.
2. Security Group: SSH 22 restrito ao IP administrativo; 80 e 443 para HTTP/HTTPS. Não abrir 5000 ou 5432 para a internet. O banco já não escuta na interface pública.
3. Com o DNS da API resolvendo, instalar/usar Certbot com Nginx para emitir certificado de `api-gas.bansir.com.br`. Trocar a configuração de manutenção pelo proxy HTTPS baseado em `deploy/nginx-api.conf.example`, com domínio real e redirecionamento HTTP→HTTPS. Conferir renovação automática. Até então, somente `/api/health` é exposto pelo Nginx; os endpoints de negócio não ficam públicos por HTTP.
4. Criar bucket S3 privado do app em `sa-east-1`, com Block Public Access. Os nomes precisam ser globalmente únicos. Não usar o endpoint de website público. O build já pode ser gerado na EC2 com Node 24 e `VITE_API_URL=https://api-gas.bansir.com.br/api/v1`; o resultado está em `/opt/bansir/app/dist`.
5. Criar distribuição CloudFront apontando ao endpoint REST do bucket, usando **Origin Access Control (OAC)**. Bucket policy permite leitura somente pela distribuição. Redirecionar o visitante para HTTPS. Publicar também imagens do app nesse bucket/prefixo de mídia; não colocar certificados/XML fiscais nele.
6. Solicitar certificado ACM para `gas.bansir.com.br` em **us-east-1**, validar por DNS e vinculá-lo ao CloudFront como domínio alternativo. No DNS atual, criar CNAME `gas` para o hostname da distribuição. Se usar Route 53, pode usar A/AAAA Alias em vez do CNAME.
7. Aplicar rewrite de rotas SPA sem extensão para `/index.html`, incluindo `/pedir/*`, por CloudFront Function. Não reescrever arquivos JS/CSS inexistentes. Usar cache longo para assets com hash e `no-cache` em `index.html` e `sw.js`; invalidar esses dois arquivos a cada publicação.
8. Conferir CORS da API, login/seleção de estabelecimento, envio PDF, link de pedidos, service worker e push no domínio HTTPS. Provisionar a loja com o dono correto; configurar frete/produtos antes de publicar o link.
9. Criar **outro bucket privado para XML fiscal**, com versionamento, criptografia e política IAM limitada. Usar IAM role da EC2 em vez de Access Keys nos arquivos. A política de exemplo fica em `deploy/fiscal-s3-policy.example.json`. Não servir XML pelo CloudFront público. Definir retenção fiscal com o responsável contábil antes de configurar exclusão automática.

Para migrar o DNS inteiro para Route 53 depois: copiar todos os registros atuais, incluindo MX/TXT de e-mail, criar a zona e só então alterar os nameservers no registrador. Essa migração não é necessária para começar com CloudFront.

Referências: [OAC e bucket privado](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [domínio no CloudFront](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html).
