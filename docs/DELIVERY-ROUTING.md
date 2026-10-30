# Sugestões e mapa de entregas

O módulo Entregas contratado habilita comparação de entregadores no aceite dos pedidos do link e na Distribuição de entregas. A escolha é confirmada pelo atendente. O cálculo considera o menor acréscimo na rota atual; empates próximos usam chegada estimada e carga. Paradas já em andamento ficam à frente. Não otimiza toda a frota nem considera trânsito em tempo real, capacidade de carga ou custo monetário.

São necessários destino confirmado, entregador ativo com conta vinculada e expediente iniciado. A posição recente (até 90 segundos, precisão até 100 metros) é usada por quem possui direito de monitorar; demais atendentes recebem comparação a partir da loja, sem receber coordenadas dos entregadores. Confirme o ponto da loja na Página de pedidos. Paradas sem coordenadas impedem uma sugestão confiável para aquele entregador; a atribuição manual continua disponível.

O mapa da dashboard exige dashboard + delivery-monitor (ou administrador), respeita a unidade e o contrato. Exibe última posição, idade do sinal, precisão, cores estáveis e paradas numeradas. Linha contínua representa trajeto planejado por ruas; tracejada representa aproximação. Não desenha histórico de deslocamentos ou movimento fictício. O PWA pode suspender GPS em segundo plano. Pausar/encerrar mantém o comportamento existente de apagar a única posição armazenada. Após consultar o provedor, a API relê permissões, posições e paradas antes de devolver o mapa.

Selecionar a sugestão envia revisão das paradas, revisão do destino, índice de inserção e validade de 60 segundos. A confirmação verifica novamente o estado na transação e reordena as paradas; conflito retorna STALE_ROUTE e desfaz a operação inteira. Aceitar o mesmo pedido novamente retorna a venda existente. Concluir entrega não registra pagamento.

## Serviço e consumo

OpenRouteService/HeiGIT, endpoint https://api.heigit.org/openrouteservice/v2, apenas Directions GeoJSON e Matrix, perfil driving-car. O provedor recebe coordenadas para calcular o trajeto; não recebe nomes, telefones ou identificadores dos clientes. Não há geocodificação automática nem contratação paga.

Configuração privada somente no ambiente do processo da API:

```dotenv
DELIVERY_ORS_API_KEY=preencher_no_arquivo_privado
DELIVERY_ORS_DIRECTIONS_DAILY_LIMIT=1500
DELIVERY_ORS_MATRIX_DAILY_LIMIT=350
DELIVERY_ORS_REQUESTS_PER_MINUTE=20
```

Arquivo local ignorado pelo Git e Docker: migration-private/maps-routing.env. Produção: /opt/bansir/backend/deploy/api.env, permissão 600. Nunca usar VITE_ para a chave, nem colocar no S3 ou no código. Runtime não recebe DATABASE_ADMIN_URL.

Limites conservadores por processo, janela de 24 horas; reiniciar reinicia os contadores locais, mas não a cota do provedor. Respostas 403/429 suspendem chamadas por 15 minutos. Cache de Matrix por unidade por 60 segundos e de trajeto por entregador por 5 minutos; chamadas simultâneas iguais compartilham a consulta. Até duas chamadas Directions em paralelo, prazo total de aproximadamente 28 segundos, timeout individual 8 segundos. A matriz usa até 50 pontos; entregador até 20 paradas; acima disso a interface indica aproximação/limitação. Sem chave ou serviço disponível, a atribuição manual funciona e estimativas ficam explicitamente identificadas. Não há garantia de gratuidade se a conta do provedor for alterada; acompanhar o painel da chave.

Leaflet 1.9.4 incluído no build e carregado somente com o mapa. Tiles interativos padrão OpenStreetMap, atribuição visível e cache normal do navegador; sem download offline ou varredura de tiles. A função CloudFront de headers foi atualizada no repositório para permitir https://tile.openstreetmap.org em img-src da CSP Report-Only. Se a função publicada ainda usar o texto antigo, atualizar seu código e publicar LIVE, mantendo Viewer response; gas-spa permanece em Viewer request. O template de ResponseHeadersPolicy é alternativa, não exige contratar plano para usar a Function existente.

## Publicação e validação

Aplicar migração 043_delivery_routes.sql com migrador; a aplicação usa somente papel de runtime. Recriar somente API após instalar variáveis privadas. Testes de integração criam bancos descartáveis e validam RBAC, isolamento, ordem, conflito, aceite idempotente, pausa durante consulta e contrato desativado. Adaptador testado com transporte simulado; chave real validada separadamente com pontos fictícios.

Frontend: npm run prepare:s3 produz PUBLICAR-BANSIR-GAS com um único build e API AWS. Publicar assets/ antes de index.html no bucket bansir-gas-app-prod-1 e preservar assets antigos no S3. Invalidar CloudFront e conferir /, /bansir-admin e os JS/CSS referenciados. Somente declarar interface publicada depois de verificar URLs públicas.
