# Banco e cadastro do Nivela

O projeto usa Supabase Auth, PostgreSQL e uma Edge Function. O navegador carrega apenas JavaScript puro e uma chave publicável. A chave administrativa permanece no ambiente da função, fora dos arquivos públicos e dos tokens de usuário.

## Preparar uma instalação nova

Confira primeiro a conta, a organização e o projeto. O ambiente do Nivela foi separado dos outros aplicativos na organização **Luiz - Faculdade**, em um projeto no plano gratuito. Não execute os scripts no banco de outro sistema.

Execute `schema.sql` uma vez no projeto novo. Ele cria perfis, transações, orçamentos, metas e mensagens de suporte, com RLS e permissões por proprietário. Depois aplique `username-auth.sql`, que prepara a quota do cadastro e a proteção contra criação de contas fora do fluxo permitido. Esses arquivos são scripts de configuração, não migrações numeradas inventadas pelo cliente. Os arquivos do repositório são a referência versionada. Aplicações pelo serviço de migrações ficam no histórico do Supabase; scripts executados diretamente no SQL Editor não recebem esse registro automaticamente.

Publique `functions/nivela-auth/index.js` como a função `nivela-auth`. Ela atende ao cadastro antes de existir uma sessão de usuário, então sua validação de entrada, chave pública e quota é feita no próprio handler. O gateway deve usar `verify_jwt = false` para essa função de cadastro. As tabelas financeiras continuam exigindo uma sessão autenticada e suas políticas de RLS. Não exponha outras funções administrativas com essa configuração.

Em `assets/js/config.js`, informe a URL do projeto e sua chave publicável `sb_publishable_...`. Não inclua `service_role`, `sb_secret_`, senha do banco ou chave SMTP nesse arquivo. As credenciais administrativas da função são lidas de `Deno.env`, no servidor.

## Usuário e senha sem e-mail

A interface solicita apenas usuário, senha e confirmação. O usuário é normalizado para minúsculas e aceita de 3 a 24 letras sem acento, números ou `_`. A senha tem no mínimo 8 caracteres e respeita o limite de 72 bytes UTF-8 do bcrypt usado pelo Auth. O valor não é cortado silenciosamente nem salvo no navegador.

O Supabase Auth exige um identificador interno de e-mail para seu fluxo de senha. A função usa um alias reservado em `accounts.nivela.invalid`, gerado a partir do usuário, e cria a conta pela API administrativa com confirmação interna. Esse endereço não é solicitado à pessoa e não recebe mensagens. Não há dependência de SMTP ou de links de confirmação. A confirmação de senha é uma verificação do formulário, distinta de confirmar um endereço por e-mail.

O cadastro marca a conta com `app_metadata.nivela_registration`. Somente a API administrativa pode definir esse campo; `user_metadata` pode ser editado pelo usuário e não participa dessa autorização. Um trigger diferido consulta a linha final de `auth.users` no fim da transação e bloqueia a criação quando faltam o marcador, o alias ou a confirmação interna. A verificação precisa ser diferida porque o Auth preenche metadata e confirmação depois do INSERT inicial, na mesma transação.

O cliente nunca grava diretamente em `auth.users`. A autenticação por senha e a renovação dos tokens seguem a API do Supabase, e a identidade é conferida em `/auth/v1/user`. O front-end não aceita um UUID ou JSON local como prova de entrada. Não existe recuperação automática de senha nesta versão sem contato de recuperação: guarde o usuário e a senha.

## Limites do cadastro

A função obtém o endereço de origem pelo cabeçalho `cf-connecting-ip` da plataforma. No ambiente publicado, foram testadas tentativas de forjar cabeçalhos: a plataforma rejeitou o valor forjado de `cf-connecting-ip`; `true-client-ip` mostrou-se controlável pelo cliente e não deve ser usado como fonte confiável. Se o endereço confiável não estiver disponível, o cadastro falha em vez de assumir um valor enviado no corpo da requisição.

A tabela privada guarda hashes HMAC do IP e do identificador do navegador, com separação de contexto e segredo do servidor. Não guarda o IP em texto nessa tabela. O identificador do navegador é um UUID persistido localmente; ele é uma barreira complementar e pode ser apagado ou trocado pelo cliente. A quota do IP permanece no servidor.

| Limite | Janela |
| --- | --- |
| 5 tentativas por IP | Últimos 60 minutos |
| 20 tentativas por IP | Últimas 24 horas |
| 3 tentativas por navegador | Últimas 24 horas |
| 200 tentativas no projeto | Últimas 24 horas |

A reserva da tentativa é atômica no PostgreSQL, usando trava de transação antes de contar e inserir. Tentativas permitidas contam mesmo se o nome já estiver em uso. Requisições bloqueadas não acrescentam linhas indefinidamente, e registros antigos são removidos pela rotina. A resposta de excesso usa HTTP 429 e informa quando tentar novamente. Há validação de formato, tamanho do corpo e um campo de detecção de preenchimento automático por bots.

Esses controles restringem a criação de contas. CORS limita as origens de uso no navegador, mas não substitui autenticação ou quota: um cliente fora do navegador pode enviar seu próprio cabeçalho de origem.

## Dados financeiros

`NivelaData.load()` devolve `{ profile, transactions, budgets, goals }`, com nomes em camelCase. A integração transforma esses campos para as colunas SQL em snake_case. Valores monetários são centavos inteiros, com teto individual de `99999999999`; o saldo inicial também admite esse limite negativo. Datas usam `YYYY-MM-DD`.

O perfil e quatro orçamentos ausentes são criados com `resolution=ignore-duplicates`, preservando valores que outra aba já tenha configurado. Conta nova começa com saldo e limites zerados, sem movimentações ou metas inventadas. O estado antigo de demonstração em localStorage não é importado automaticamente para uma conta.

Transações usam `paid` ou `pending`. O resumo e o saldo consideram pagamentos e recebimentos confirmados; a agenda acompanha os pendentes; os orçamentos também incluem gastos previstos. Transferências são neutras no saldo consolidado. Parcelamento divide o total, enquanto recorrência repete o valor. As parcelas futuras começam pendentes.

As consultas são paginadas, mesmo quando o servidor limita cada resposta a menos de mil linhas. O cliente verifica a identidade antes e depois das requisições e descarta uma resposta antiga se a conta mudar. As políticas do banco verificam `auth.uid()` independentemente desses filtros do cliente.

`saveTransactions` insere o lote de parcelas em uma requisição. `saveBudgets` valida todos os limites e envia um único upsert, evitando gravação parcial do formulário. `saveGoal`, `updateTransaction` e as exclusões agem somente sobre registros disponíveis à conta. O suporte registra nome, assunto e mensagem sem exigir e-mail, com INSERT autorizado e sem leitura da tabela pelo navegador.

## Verificações

Execute os testes nativos descritos em [tests/README.md](../tests/README.md). Esses testes simulam o transporte e não comprovam a configuração remota. No projeto real, verifique o cadastro, o login, a persistência, as tentativas simultâneas e o isolamento entre duas contas. A API anônima não deve ler tabelas financeiras nem chamar a função administrativa de reserva de tentativas.

Após mudanças de schema, consulte os advisors. No banco novo, índices ainda sem uso podem aparecer como informação de performance; preserve os índices que atendem às consultas previstas. Referência: [unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [segurança da Data API](https://supabase.com/docs/guides/api/securing-your-api), [funções Edge](https://supabase.com/docs/guides/functions) e [Auth Admin](https://supabase.com/docs/reference/javascript/auth-admin-createuser).
