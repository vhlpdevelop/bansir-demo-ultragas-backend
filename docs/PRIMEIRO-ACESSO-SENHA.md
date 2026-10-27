# Primeiro acesso e alteração de senha

A migração 011 acrescenta o indicador de troca obrigatória de senha e nomes empresariais separados dos nomes de exibição. O provisionamento aceita razão social, nome fantasia, CNPJ e `mustChangePassword`, sem redefinir credenciais de identidades existentes.

Contas provisionadas com senha temporária devem usar `mustChangePassword: true`. Após login e seleção da unidade, a API permite consultar o próprio perfil e trocar a senha, mas bloqueia os módulos de negócio com `PASSWORD_CHANGE_REQUIRED`. O app mostra automaticamente a página de troca antes do PDV. O bloqueio é validado no servidor; ocultar a tela não libera operações.

Usuários PostgreSQL também podem abrir `/?pagina=alterar-senha`, pelo link **Alterar senha** na barra superior. Essa URL funciona mesmo antes de configurar o rewrite SPA no CloudFront; `/alterar-senha` também é reconhecido pelo app quando o rewrite estiver ativo. A troca exige senha atual, nova senha de pelo menos oito caracteres (até 72 bytes UTF-8) e confirmação no app. A API não aceita identificador de usuário para trocar a senha de outra pessoa. Senhas são armazenadas como bcrypt custo 12; o runtime não recebe permissão de UPDATE direto na tabela de usuários.

A função de troca altera apenas a identidade autenticada, remove o indicador temporário e revoga todas as sessões e seleções pendentes dessa identidade, em todas as unidades. Após salvar é necessário entrar novamente. A senha antiga deixa de autenticar. O endpoint aplica limite de tentativas e não registra os campos de senha nos logs.

Implantação: gerar backup, atualizar os clones GitHub, reconstruir a imagem, aplicar a migração 011 com a credencial administrativa isolada e recriar a API. O login administrativo de migração deve voltar a NOLOGIN em um bloco finally. Publicar também o novo build do app no S3 e invalidar o cache do CloudFront: a tela de primeiro acesso depende dessa versão do frontend.

Validação: teste PostgreSQL cobre senha temporária, bloqueio dos módulos, senha atual errada, nova senha curta, tentativa de informar outro usuário, troca bem-sucedida, revogação de sessões, rejeição da senha antiga e entrada com a nova. O provisionamento também verifica razão social, nome fantasia e documento da unidade. Contas e senhas reais não fazem parte do repositório.
