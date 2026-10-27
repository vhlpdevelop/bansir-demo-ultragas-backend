# PostgreSQL multi-tenant — primeira etapa

**Atualização de clientes e pedidos:** [migrações 008–009, entregadores, importação PDF e página pública isolada por estabelecimento](CLIENTES-ENTREGAS-PEDIDOS.md).

**Atualização do PDV:** [núcleo de venda, caixa, recebimentos e pendências restantes](PDV-POSTGRES.md). A migração 007 acrescenta o PDV PostgreSQL; as limitações de vendas indicadas na inspeção original abaixo são históricas. A importação de histórico Mongo continua pendente.

**Atualização de workers/fiscal:** [estrutura implementada, configuração e limites de produção](WORKERS-PRODUCTION.md). As migrações 003–006 acrescentam notificações, filas, certificado criptografado, cadastro fiscal e numeração por estabelecimento.

Situação de execução em Docker, PWA e jobs: [verificação de workers e notificações](C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/docs/DOCKER-WORKERS-PWA.md).

Implementado: API PostgreSQL separada da API legada, autenticação com empresa e
estabelecimento ativos, seleção de unidade no login, catálogo/categorias,
movimentos e resumo de estoque, configurações por estabelecimento, RLS e importação
transacional da base inicial. O RBAC é específico do vínculo usuário–estabelecimento.

**Esta etapa não é o corte completo do sistema.** Vendas, financeiro, clientes,
fornecedores, funcionários, frota, vales, relatórios, push, Meta e fiscal ainda
precisam migrar. No modo PostgreSQL, suas rotas retornam
`503 MODULE_MIGRATION_PENDING`; nenhum router de negócio MongoDB é montado.
A demo existente continua em MongoDB até configurar `DATABASE_ENGINE=postgres`
ou executar `npm run start:postgres`. Não publique essa etapa como substituta
completa da operação atual.

## Preparar PostgreSQL

Use uma base dedicada. Para EC2, instale PostgreSQL em versão estável suportada,
com dados em EBS persistente e criptografado, processo supervisionado, backups
externos e recuperação testada. Se API e PostgreSQL estiverem na mesma EC2,
use loopback/socket; não exponha a porta do banco publicamente.

O schema fica em `bansir`. Existem duas credenciais com finalidades diferentes:

- `DATABASE_ADMIN_URL`: somente migração/provisionamento/importação. A primeira
  migração cria o papel de grupo `bansir_runtime` e requer privilégio para isso.
  O provisionamento/importação precisa de acesso administrativo com bypass RLS.
- `DATABASE_URL`: execução da API, com login membro de `bansir_runtime`, sem
  superuser/BYPASSRLS/propriedade das tabelas. O startup rejeita papéis que
  ignorariam o isolamento.

Depois de configurar a credencial administrativa no shell de manutenção:

```powershell
npm ci
npm run db:migrate
```

As migrações são versionadas, transacionais por arquivo e serializadas por lock.
O checksum impede modificar silenciosamente um arquivo já aplicado. Novas
alterações exigem uma nova migração. Não são executadas pelo startup da API.

Com a ferramenta administrativa do PostgreSQL, crie um login de execução com
senha forte e conceda o grupo:

```sql
CREATE ROLE bansir_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
-- Defina a senha com o mecanismo seguro da ferramenta administrativa.
GRANT bansir_runtime TO bansir_app;
```

Configure `DATABASE_URL` com esse login no ambiente da API. Não disponibilize
`DATABASE_ADMIN_URL` ao processo de aplicação da EC2.

Configuração de execução:

```dotenv
DATABASE_ENGINE=postgres
DATABASE_URL=postgresql://bansir_app:URL_ENCODED_PASSWORD@127.0.0.1:5432/bansir
NODE_ENV=production
JWT_SECRET=USE_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
POSTGRES_JWT_EXPIRES_IN=1h
CORS_ORIGIN=https://app.example.com
TRUST_PROXY_HOPS=0
```

Defina a quantidade real de proxies para a topologia escolhida. As origens CORS
devem ser explícitas em produção. JWTs do legado não são aceitos pela API nova.
`npm start` utiliza `DATABASE_ENGINE`; `npm run start:postgres` força PostgreSQL.
No projeto do app, `npm run dev:postgres` usa o proxy local para a API na porta
5000; esse modo não carrega a configuração de desenvolvimento que aponta ao
Render. Para o build hospedado, defina `VITE_API_URL` com a URL da API nova.

## Criar uma empresa vazia ou importar a base inicial

Escolha um dos caminhos para o tenant inicial; a importação recusa sobrescrever
um tenant já provisionado. O bootstrap não tem senhas padrão e não redefine
identidades globais existentes.

### Empresa vazia

No shell administrativo, defina:

```dotenv
BOOTSTRAP_TENANT_SLUG=ultragas
BOOTSTRAP_TENANT_NAME=Ultragas
BOOTSTRAP_ADMIN_NAME=Nome do responsável
BOOTSTRAP_ADMIN_EMAIL=responsavel@example.com
BOOTSTRAP_ADMIN_PASSWORD=UNIQUE_PASSWORD_12_TO_72_CHARACTERS
```

```powershell
npm run db:provision
```

Cria empresa, estabelecimento inicial, configuração e administrador vinculado
àquela unidade. Nenhuma venda, produto, estoque ou receita de exemplo é criada.
Papéis da plataforma ainda não estão implementados; `superadmin` importado
continua limitado ao seu tenant na API nova.

### Exportação/importação inicial do MongoDB

Esse importador cobre **usuários, vínculos empresariais, produtos, categorias,
configurações e saldo de abertura de estoque**. Não transfere histórico de
vendas/movimentos nem financeiro. Os demais conjuntos aparecem no manifesto
como pendentes. Não é uma ferramenta de corte total.

1. Confirme que os dados selecionados pertencem à empresa indicada. O MongoDB
   legado não carrega tenant nos registros.
2. Suspenda as escritas na origem para uma exportação consistente. Use conexão
   MongoDB somente de leitura; o exportador não usa modelos nem cria índices.
3. Defina `MONGODB_URI` com banco explícito, `MIGRATION_TENANT_SLUG` e
   `MIGRATION_TENANT_NAME`. Proteja o snapshot: contém hashes e dados pessoais.
4. Exporte, confira o plano e aplique em PostgreSQL de staging com credencial
   administrativa. Use um diretório privado; `migration-private/` é excluído
   de Git e da imagem Docker. O exportador não sobrescreve arquivos existentes.

```powershell
New-Item -ItemType Directory -Path migration-private
npm run db:export:foundation -- migration-private/ultragas.json
npm run db:import:foundation -- migration-private/ultragas.json --plan
npm run db:import:foundation -- migration-private/ultragas.json
```

O plano apenas valida/conta o arquivo e não conecta ao PostgreSQL. A aplicação
do lote é atômica: conflito em um produto reverte também empresa e usuários
criados pelo lote. Reaplicar o mesmo snapshot não modifica os saldos já usados.
Um snapshot diferente para empresa existente é recusado. Conflitos de identidade
global com hash divergente também exigem reconciliação, sem sobrescrever senha.

Preservam-se hashes bcrypt, IDs antigos de produto e IDs antigos de usuário no
vínculo empresarial, preparando as referências dos próximos módulos. As contas
com senhas fixas da demo ainda precisam da redefinição prevista no diagnóstico.
O importador não transforma essas credenciais em senhas seguras por si só.

## Isolamento implementado

- Identidade global, associação à empresa e vínculos específicos de estabelecimento.
  Cargo/permissões operacionais vêm do vínculo com a unidade selecionada.
- JWT fixo em empresa e estabelecimento, vinculado a uma sessão persistida.
- Com várias unidades acessíveis, o login emite ticket de seleção de cinco minutos
  e uso único. Apenas estabelecimentos autorizados aparecem. Com somente uma
  unidade acessível, a entrada é automática nela.
- Cada transação revalida usuário, empresa, estabelecimento, vínculo e sessão.
- RLS obrigatório nas tabelas empresariais, `FORCE ROW LEVEL SECURITY`, políticas
  de leitura e escrita, contexto local à transação na mesma conexão.
- Sem contexto, consultas às tabelas empresariais não retornam linhas. O teste
  de isolamento também executa consultas sem filtro de tenant deliberadamente.
- Código de barras único por empresa/estabelecimento e chaves estrangeiras
  compostas impedindo movimentos vinculados a produtos de outra unidade.
- Runtime não pode alterar memberships, criar empresas ou remover políticas.
- O cabeçalho mostra a unidade atual sem dropdown. Para trocar, o usuário volta
  à tela de seleção; o servidor revoga a sessão anterior e o app descarta seu
  estado antes de mostrar essa tela. Uma nova seleção emite outra sessão.
- O token PostgreSQL fica em `sessionStorage`, separado por aba. Recarregar mantém
  a unidade atual; trocar numa aba não substitui silenciosamente o token de outra.

Identidades globais podem ser lidas pelo serviço de autenticação para validar
login, mas não existe endpoint para enumerar usuários globais. O contexto RLS é
definido pelo backend depois da autenticação; não protege uma aplicação que
deliberadamente aceite identidade arbitrária ou SQL do cliente.

Referências: [transações node-postgres](https://node-postgres.com/features/transactions),
[RLS PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Testes

```powershell
npm run test:postgres
```

Requer Docker disponível. O script cria um PostgreSQL 17 descartável, com nome,
banco, senhas e porta aleatórios; aplica as migrações e remove somente o container
que criou ao terminar. Não usa `MONGODB_URI`, `DATABASE_URL` ou qualquer banco
da aplicação. Credenciais de teste ficam apenas no ambiente dos processos.

Valida seleção de estabelecimento, RBAC diferente por unidade, tickets/JWTs, RLS, contexto de pool após
commit/rollback, tentativas de vinculação cruzada, permissões, estoque concorrente,
configurações, revogação, bootstrap e rollback/repetição do importador. Os testes
de integração ficam pulados na suíte comum quando as URLs exclusivas de teste
não estão presentes; use este comando para realmente executá-los.

Próxima etapa: migrar pedidos/vendas, itens, pagamentos e recebíveis, preservando
idempotência e atomicidade com estoque. Depois migrar os demais módulos e
integrações antes do corte definitivo. O ambiente hospedado permanece inalterado.

## Verificação desta entrega — 27/10/2026

- PostgreSQL real em Docker descartável: 12 testes passaram (suíte principal e
  onze cenários), incluindo limites de plano sob concorrência, revogação ao
  voltar à seleção e upgrade da migração 001 com dados existentes.
- Sessões do app: quatro testes passaram (suíte principal e três cenários),
  cobrindo abas independentes e ausência de fallback para token legado na seleção.
- App: build de produção e checagem CSS passaram. Vite ainda informa
  bundle grande, uma otimização pendente do app existente.
- Navegador: login com duas unidades da mesma empresa, entrada na Matriz,
  retorno à seleção e entrada na Filial com perfil diferente verificados com
  respostas simuladas. Recarregar mantém a Filial; controles de escrita ficam
  desabilitados para o operador. Layout conferido em desktop e celular. A UI usa
  mocks; a API e o isolamento foram testados separadamente no PostgreSQL real.
- Regressão legada selecionada: 22 testes passaram; o runner registra 3 falhas,
  correspondentes a dois subtestes JWT/RBAC e ao teste pai que os agrupa.
  Os arquivos de autenticação/permissões MongoDB desses testes não foram alterados.
- Nenhuma conexão de migração com o banco hospedado foi executada. Nenhuma conta
  AWS/Meta nem certificado real foi utilizada.

## Planos e quantidade de estabelecimentos

A migração `002_establishment_access.sql` acrescenta planos com capacidade
configurável, vínculos de unidade, sessões revogáveis e isolamento operacional
por estabelecimento. A migração 001 permanece inalterada.

O limite é aplicado no PostgreSQL, inclusive para cadastros administrativos
simultâneos. Unidades inativas continuam contando como estabelecimentos
cadastrados; desativar não libera uma vaga implicitamente. Uma troca para plano
menor que a quantidade já cadastrada é recusada, sem desativar unidades à força.
Capacidades são versionadas: para mudar um limite, crie outra revisão de plano
e atribua-a à empresa. Não há nomes, preços ou limites comerciais predefinidos.

`migration-single` é apenas a capacidade técnica inicial de uma unidade usada
no bootstrap/importação. Substitua-a pelo plano comercial efetivo. A integração
com faturamento e a tela de administração desses cadastros seguem pendentes;
nesta etapa, a manutenção usa credencial administrativa fora da API.

Para cadastrar/atribuir um plano, defina no shell administrativo:

- `MANAGE_TENANT_SLUG`: empresa de destino.
- `MANAGE_PLAN_CODE` e `MANAGE_PLAN_NAME`: identificação da revisão de plano.
- `MANAGE_PLAN_MAX_ESTABLISHMENTS`: quantidade contratada, inteiro positivo.

Execute `npm run db:plan:assign`.

Para cadastrar uma unidade dentro desse limite:

- `MANAGE_TENANT_SLUG`, `MANAGE_ESTABLISHMENT_NAME` e, opcionalmente,
  `MANAGE_ESTABLISHMENT_DOCUMENT`.
- `MANAGE_ESTABLISHMENT_MEMBERSHIPS`: array JSON com `userId`, `role` e
  `allowedRoutes` para cada usuário. Os usuários já devem ter associação à empresa.

Execute `npm run db:establishment:create`. Administrar a Matriz não concede
automaticamente acesso nem o mesmo RBAC à Filial; o vínculo é explícito.

A migração de dados existentes atribui registros da base inicial à única unidade
preexistente e preserva seus cargos nessa unidade. Bases que já possuam várias
unidades são recusadas pela migração 002, exigindo mapeamento explícito antes
de prosseguir; o processo não escolhe arbitrariamente a unidade dos dados.
