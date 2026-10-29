# Imagens do catálogo

1. Criar stack CloudFormation na região sa-east-1 usando product-images-cloudformation.yaml; marcar reconhecimento de criação de recursos IAM. O template cria bucket dedicado privado com criptografia/versionamento e política mínima PutObject/GetObject em products/* para a role existente bansir-gas-1-role. Não usa bucket do app, institucional ou fiscal, nem acesso público.
2. Aplicar migração 032 com o processo habitual. Definir PRODUCT_IMAGES_BUCKET=bansir-gas-product-images-prod-783764583281 em deploy/api.env na EC2 e recriar somente api após a stack terminar. Não definir DATABASE_ADMIN_URL no processo da API.
3. Publicar todo o conteúdo de PUBLICAR-BANSIR-GAS com assets/ preservado, assets antes do HTML e invalidar o CloudFront.
4. No catálogo, depois de cadastrar o produto, usar Adicionar imagem/Trocar imagem no card. Aceita JPG, PNG e WebP até 2 MB. Não aceita SVG/HTML. A API verifica formato por assinatura e MIME, contexto de estabelecimento e permissão Produtos; entrega a imagem somente a usuário autenticado autorizado.

Identificação: UUID de imagem, UUID do produto, tenant e estabelecimento no caminho products/tenant/unidade/produto/imagem.ext. Metadados no PostgreSQL, bytes no S3. Sem nomes de arquivo fornecidos pelo cliente. Substituição gera novo UUID. Objetos antigos são preservados; limpeza de órfãos não está automatizada. Uma falha de transação depois do upload pode deixar um objeto sem vínculo; nunca expõe imagem de outro tenant.

RBAC: Produtos (criar, editar, imagens e estoque) já protege criação via POST /products no backend e controla os botões no catálogo. Administradores possuem acesso completo. Operador apenas com vendas lê o catálogo, mas não cria produtos nem envia imagens. Esta etapa não separa uma permissão exclusiva de criar das demais operações de Produtos.

Infra pendente: tentativa de criação usando a role da EC2 retornou AccessDenied em 29/10/2026. O bucket não foi criado por essa tentativa. O backend sem PRODUCT_IMAGES_BUCKET responde IMAGE_STORAGE_PENDING. Só confirmar funcionamento real após criar a stack, configurar env e testar upload/leitura autenticados. Testes automatizados usam S3 em memória e PostgreSQL descartável, sem envio real.
