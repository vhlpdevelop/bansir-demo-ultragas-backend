# Ficha de clientes e nono dígito

A migração 012 e as telas PostgreSQL acrescentam ficha com cadastro, e-mail, nascimento confirmado, observações, código e contatos originais do PDF. A lista tem busca e paginação; o administrador pode cadastrar e editar clientes. Datas originais do relatório continuam identificadas como origem, sem serem convertidas automaticamente em nascimento confirmado.

A ficha mostra vendas com itens, valores, recebimentos, saldo pendente, vencimento, frete, endereço e entregador histórico. Os totais financeiros excluem vendas canceladas. Pedidos do link aparecem em uma lista separada, com status e valores; pedidos aceitos e respectivas vendas não são somados em duplicidade. As duas listas são paginadas. A associação é por customer_id ou pela venda vinculada, nunca por nome parecido. Pedidos públicos são informações ainda sujeitas à conferência da equipe.

Celulares brasileiros com DDD e oito dígitos começando em 6–9 recebem o prefixo 9 antes do número local. Números fixos começando em 2–5 não são alterados, nem é inventado um DDD ausente. Exemplo fictício: `65 9999-1111` é equivalente a `65 99999-1111`. A mesma regra é usada no cadastro, importação, busca administrativa, associação do pedido público e consulta durante aceitação.

A migração corrige os telefones ativos existentes quando há uma única correspondência dentro da empresa/unidade. Pode recuperar o contato original do PDF quando o campo principal está vazio. Preserva o valor anterior e marca conflitos nos metadados. Não mescla clientes nem altera os snapshots de vendas antigas. Quando dois clientes têm o mesmo número normalizado, a associação automática fica ambígua e a equipe precisa revisar antes da aceitação. Um número incompleto demais continua exigindo correção manual.

No link público, informar o telefone continua iniciando uma sessão sem retornar nome, endereço, documento ou indicação de existência do cliente. O reconhecimento acontece internamente. Não há verificação de posse ou preenchimento de dados pessoais nesta etapa, conforme decisão anterior.

Aplicar a migração 012 com backup prévio, atualizar a API e publicar o novo build do app no S3, invalidando o CloudFront. Não há importação automática dos PDFs para uma empresa real nessa atualização. Dados anteriores ao uso do SaaS só aparecem como histórico de origem se constarem no arquivo; a lista de clientes não permite reconstruir vendas antigas.
