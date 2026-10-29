# Contenção de leitura de PDF — SEC-04

Importação de clientes e produtos continua validando o PDF e exigindo conferência da prévia antes de gravar cadastros. O contrato da prévia foi preservado. A leitura pesada do PDF.js passou de execução dentro do Express para um processo Node de curta duração, encerrado após cada arquivo.

## Limites

- Arquivo até 5 MB; o tamanho codificado também é verificado antes de decodificar.
- Até 250 páginas de clientes e 100 de produtos, 25 mil linhas, 200 mil itens de texto, 2 milhões de caracteres extraídos e 8 MB no resultado serializado.
- Prazo máximo de 25 segundos. Timeout, crash ou aborto de conexão encerram apenas o parser e liberam sua vaga após o encerramento do processo.
- Heap V8 do parser: 192 MiB. Não é um limite de RSS; buffers nativos também consomem memória. O container da API tem teto adicional de 768 MiB, 1 CPU e 128 processos, definidos após conferir o host de aproximadamente 4 GB de RAM.
- Produção: `PDF_MAX_CONCURRENT=1`, sem fila ilimitada em memória. O limite global é configurável de 1 a 4 por processo de API; a leitura simultânea por empresa e por usuário é limitada a uma. Excesso retorna HTTP 429 / `PDF_BUSY` e `Retry-After: 5`.
- O parser não recebe DATABASE_URL, credenciais AWS, JWT_SECRET, NODE_OPTIONS ou outros segredos do ambiente da API. Apenas variáveis de sistema necessárias à execução são copiadas. Conteúdo de PDFs e diagnósticos do parser não são enviados ao stdout/stderr.

O processo separado é contenção de trabalho e falhas, não um sandbox completo contra execução arbitrária. Ele continua com o mesmo usuário/container e acesso aos arquivos permitidos a esse usuário. Não substituir essa contenção por uma promessa de isolamento de rede ou hardware. Com várias réplicas da API, cada réplica tem seu próprio limite; um worker com isolamento e quotas distribuídas é a evolução para maior escala. Geração de outros PDFs e os demais workers não passaram a ter uma fila distribuída nesta alteração.

## Erros e observabilidade

- `INVALID_PDF` / `PDF_READ_FAILED`: conteúdo inválido, ilegível ou protegido.
- `PDF_TOO_LARGE`: páginas, texto ou resultado excedem limites; dividir o arquivo.
- `PDF_TIMEOUT`: prazo encerrado; dividir o arquivo.
- `PDF_RESOURCE_LIMIT`: subprocesso interrompido/crash; arquivo pode exceder recursos.
- `PDF_ABORTED`: conexão abandonada.
- `PDF_WORKER_UNAVAILABLE`: falha de infraestrutura; não expor detalhes internos ao cliente.

Não reenviar automaticamente o arquivo em loops. A prévia não confirma importação nem duplica produtos/clientes. Os fluxos de confirmação mantêm RBAC, RLS, idempotência e transações existentes.

## Verificação

`node --test test/pdf-isolation.test.js`: PDF real sintético, hash, limite de páginas, quotas por empresa/usuário/global, CPU bloqueada com saúde HTTP responsiva, timeout, crash, cancelamento e ambiente sem segredos. O fixture fica em `scripts/testing/` e é excluído da imagem de produção.

`npm run test:postgres -- test/storefront.integration.test.js test/jasley-import.integration.test.js test/pdv.integration.test.js test/pdv-terminals.integration.test.js`: regressão de extração/importação e operações do PDV em banco descartável.

Depois de publicar, conferir `Memory`, `NanoCpus` e `PidsLimit` do container, `PDF_MAX_CONCURRENT=1` e a saúde pública da API. Verificar o parser dentro da imagem com PDF técnico sintético, sem importar registros nem consultar dados de clientes. Não executar testes de exaustão na EC2 de produção.
