# Banco do Nivela

`schema.sql` é um script de configuração inicial, não uma migração numerada. Ele deve ser revisado e executado uma vez em um projeto Supabase novo, na conta escolhida para o Nivela. Não execute no projeto de outro aplicativo. Se as tabelas já existirem, compare o esquema antes de qualquer alteração; o script para em conflitos em vez de apagar dados ou presumir uma atualização.

## Configurar o projeto

1. Confira a conta, a organização e o identificador do projeto de destino.
2. No SQL Editor desse projeto, execute o conteúdo de `schema.sql` como administrador.
3. Mantenha o schema `public` disponível na Data API. O script habilita RLS em todas as cinco tabelas e concede somente as operações utilizadas pelo cliente à função `authenticated`. A função `anon` não recebe acesso às tabelas.
4. Configure Auth com os valores de URL e senha indicados abaixo, mantendo a confirmação de e-mail habilitada.
5. Na configuração pública do front-end, use a URL do projeto e sua chave publicável. Uma chave `service_role` ou secret não deve ser incluída no navegador ou no repositório.

O esquema não contém trigger de criação de perfil nem função `security definer`. Após autenticar, `NivelaData.load()` cria o perfil e os quatro limites de orçamento ausentes com `resolution=ignore-duplicates`. Se outra aba tiver criado ou alterado um registro, os valores existentes são preservados e consultados novamente. O saldo inicial e os limites começam em zero; as transações e metas começam vazias. Dados da antiga demonstração não são importados automaticamente.

## Configurações de Auth

Em **Authentication → URL Configuration**, configure:

- **Site URL:** `https://luizfelip-dev.github.io/website/`.
- **Redirect URLs:** `https://luizfelip-dev.github.io/website/login.html**`.
- Para o servidor local na porta 8000, autorize também `http://localhost:8000/login.html**` e, se esse endereço for usado, `http://127.0.0.1:8000/login.html**`.

O sufixo `**` permite o retorno do fluxo de confirmação/recuperação para essa página com seus parâmetros. Evite permitir origens ou caminhos que o aplicativo não utiliza. Em **Authentication → Sign In / Providers → Email**, mantenha **Confirm email** ativo, habilite o provedor de e-mail/senha e configure senha mínima de **8 caracteres**. O cliente também exige esse mínimo, mas a configuração do Auth é necessária para aplicá-lo no servidor.

### Envio de confirmação e recuperação

O SMTP padrão do Supabase é destinado a testes. Sem SMTP próprio, ele envia apenas para endereços de membros da equipe da organização: outro destinatário pode receber `email_address_not_authorized`. Isso não libera todos os endereços de um mesmo domínio. O serviço também tem limites baixos de envio, que podem mudar; consulte **Authentication → Rate Limits** antes dos testes.

Para permitir inscrições de terceiros, prepare um SMTP próprio com remetente e domínio validados no fornecedor, ou outra configuração de envio explicitamente aprovada. Esse serviço pode ter limites e custos próprios, mesmo com o banco no plano gratuito. Credenciais SMTP devem ficar nas configurações do projeto, nunca no JavaScript publicado. **Não desabilite a confirmação de e-mail** para contornar erros de entrega, limites ou a autorização de destinatários.

As configurações descritas são instruções de preparação. A existência destes arquivos não comprova que um projeto remoto já tenha sido criado, que o esquema tenha sido aplicado ou que um e-mail tenha sido entregue.

## Contrato do cliente

Carregue `assets/js/data.js` depois de `session.js` e antes de `app.js`. O módulo espera:

```js
window.NivelaSession.ready; // Promise de inicialização da sessão
await window.NivelaSession.getUser(); // { id, email, user_metadata? }
await window.NivelaSession.request("/rest/v1/profiles?...", {
  method: "GET", // GET é o padrão
  body: {},      // objeto que o transporte serializa como JSON
  headers: {},
}); // JSON parseado, ou null se a resposta não contiver corpo
```

O transporte adiciona URL do projeto, chave publicável e token do usuário. Erros HTTP devem rejeitar a Promise. O repositório de dados obtém `user_id` da sessão e ignora campos de proprietário fornecidos nos formulários. As políticas de RLS verificam a mesma propriedade no banco, inclusive em atualizações.

`NivelaData.load()` retorna `{ profile, transactions, budgets, goals }`. Os objetos usam camelCase:

- Perfil: `userId`, `fullName`, `openingBalanceCents`.
- Transação: `id`, `userId`, `type`, `description`, `amountCents`, `category`, `date`, `recurring`, `installment`, `installmentCount`, `seriesId`, `status`, `createdAt`.
- Orçamento: `category`, `limitCents`.
- Meta: `id`, `name`, `targetCents`, `savedCents`, `tone`.

Datas permanecem como `YYYY-MM-DD`; valores monetários são inteiros seguros em centavos, com teto individual de `99999999999` centavos (R$ 999.999.999,99). O saldo inicial também admite esse limite negativo. Transações usam status `pending` ou `paid`, sem filtrar datas ou status no carregamento. A aplicação decide quais valores entram no saldo e no orçamento. O carregamento pagina os resultados até receber uma página vazia, inclusive se o limite de linhas configurado no servidor for menor que 1000. A identidade da sessão é conferida antes e depois de cada requisição, para não entregar os dados de uma conta após uma troca de usuário.

As gravações retornam os objetos normalizados. `saveTransactions(entries)` retorna um array e envia o lote em uma única requisição, de modo que uma violação rejeita a inserção do lote. `saveGoal(goal)` cria quando `id` não é informado e atualiza a própria meta quando ele está presente. `updateTransaction(id, changes)` aceita somente campos financeiros conhecidos. `deleteTransaction(id)` e `deleteGoal(id)` retornam `{ id }` ou falham se o registro não estiver disponível à conta. `saveProfile()` aceita nome e saldo inicial. `saveBudget(category, limitCents)` grava uma categoria; `saveBudgets([{ category, limitCents }])` valida o conjunto inteiro e envia um único upsert, evitando gravação parcial dos limites de um formulário.

`sendSupport({ name, email, subject, message })` insere uma mensagem e retorna `{ id }`. O navegador não recebe permissão para consultar ou alterar a tabela de contatos. Isso registra a solicitação no banco; não implementa envio de e-mail nem resposta automática de uma equipe.

## Verificações antes de publicar

Em um projeto de teste, autentique duas contas diferentes. Crie registros com a primeira e confirme que a segunda não pode listá-los, alterá-los, excluí-los ou inserir dados com o `user_id` alheio. Verifique também o bloqueio de acesso sem autenticação, valores fracionários em campos de centavos, parcela inválida, categoria desconhecida e uso simultâneo de recorrência e parcelamento. Consulte os advisors de segurança/performance após aplicar o script. As policies usam `(select auth.uid())` e as consultas de dados possuem índices iniciados por `user_id`.

Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [segurança da Data API](https://supabase.com/docs/guides/api/securing-your-api), [limites e paginação](https://supabase.com/docs/reference/javascript/range), [redirecionamentos do Auth](https://supabase.com/docs/guides/auth/redirect-urls), [SMTP próprio](https://supabase.com/docs/guides/auth/auth-smtp) e [testes de e-mail](https://supabase.com/docs/guides/auth/testing-auth-flows).
