# Terminais do PDV

O terminal identifica um posto de atendimento, como Terminal 1 ou Terminal 2. É independente da maquininha de cartão e do Bridge. Os terminais pertencem a uma empresa e estabelecimento, com RLS e chaves estrangeiras compostas.

## Ativação

Em **Configurações → Terminais**, um administrador cadastra o nome e gera um código de ativação. O PDV mostra apenas identificação compacta e um atalho para essa aba. O código é aleatório, válido por 10 minutos, de uso único e armazenado apenas como hash no servidor. Um operador autenticado com acesso ao PDV informa esse código em Configurações → Terminais no navegador do posto. A API emite um vínculo separado da sessão do usuário; o banco guarda somente o hash. O navegador mantém o vínculo por empresa/unidade, mesmo após logout; cada operador continua usando sua própria conta.

Cada terminal tem um único vínculo vigente. Nova ativação revoga o vínculo anterior. Não é uma identificação física ou atestação de hardware: o vínculo identifica o perfil do navegador. Não compartilhar ou copiar seu armazenamento para outros computadores. Ao limpar o armazenamento do site, é necessário ativar novamente. O vínculo não concede acesso à API sem login nem amplia as permissões do usuário.

## Caixa e rastreabilidade

- Um caixa aberto por operador e um caixa aberto por terminal em cada unidade. Bloqueios transacionais e índice único impedem aberturas concorrentes no mesmo terminal.
- Abertura registra usuário, terminal, nome do terminal e data/hora no servidor. O fechamento preserva essa origem. Trigger impede alterar usuário, terminal e horário de abertura de um caixa existente.
- Vendas herdam o terminal do caixa de origem; recebimentos posteriores mostram o terminal do caixa que recebeu, que pode ser diferente do terminal da venda. Não se aceita `terminalId` no corpo de uma venda.
- Caixa de outro terminal não pode receber vendas, pagamentos, sangrias, suprimentos, estornos ou fechamento com o vínculo errado. Detalhes e recibos continuam exigindo autoria ou permissão de coleta/gestão, mesmo quando outro operador reutiliza o terminal.
- Administradores consultam os últimos 50 turnos de cada terminal, com operador e horários, e os últimos 100 eventos de cadastro/ativação/desativação. A API não permite alterar ou excluir esses eventos.
- A desativação exige caixa fechado e revoga o vínculo. Reativação exige novo código.

## Troca ou perda do navegador

Com caixa fechado, gerar um novo código e ativar o navegador substituto. Se o navegador foi perdido com caixa aberto, usar **Recuperar vínculo**, exclusivamente como administrador, informando um motivo com pelo menos 10 caracteres. Esse motivo e o administrador ficam no histórico. A ativação de recuperação revoga o navegador anterior e mantém o caixa com seu operador, valores e horários originais. O operador faz login no navegador substituto e continua o mesmo turno. Nenhum fechamento ou valor é inventado para recuperar o acesso.

## Implantação e registros anteriores

Migração aditiva `035_pdv_terminals.sql`. Não atribui Terminal 1 retroativamente às vendas ou caixas antigos. Esses registros aparecem como terminal não identificado. O fechamento de um caixa antigo continua permitido, inclusive após a ativação dos terminais.

A API mantém compatibilidade com o frontend anterior enquanto o estabelecimento não ativou nenhum terminal. A **primeira ativação** exige vínculo nas novas operações da unidade; desativar todos os terminais não remove essa exigência. Publique o frontend completo antes de iniciar a ativação. No frontend novo, o fluxo de abertura já orienta a ativar o navegador. Feche caixas antigos antes de iniciar os novos turnos identificados.

O frontend completo é gerado com `npm run prepare:s3` em `../PUBLICAR-BANSIR-GAS`, preservando `assets/` e a API AWS. Não misturar versões nem mover arquivos de assets para a raiz do bucket.

## Validação

`npm run test:postgres -- test/pdv-terminals.integration.test.js test/pdv.integration.test.js`: PostgreSQL descartável, contas sintéticas, isolamento entre empresas/unidades, RBAC, código expirado/reutilizado, corrida de abertura, caixa em outro terminal, credencial revogada, recuperação com caixa aberto, origem imutável, fechamento legado e regressão de acesso aos recibos (SEC-01).

`node --test test/pdvTerminal.test.js test/authSession.test.js` no app verifica separação dos vínculos por unidade e persistência após troca de operador. Verificação de interface com Playwright na prévia local descartável.
