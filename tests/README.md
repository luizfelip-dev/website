# Verificação do cliente

Com Node.js 20 ou mais recente, execute na raiz do repositório:

```bash
node tests/auth.test.cjs
node tests/data.test.cjs
node tests/edge.test.cjs
```

Esses testes usam apenas módulos nativos do Node. A suíte da Edge simula o ambiente Deno e verifica validação, tamanho do corpo, timeouts, origem, hashes e o tratamento de quota antes da criação da conta. Não precisam instalar dependências, iniciar um servidor ou conectar um projeto Supabase. Os endereços, usuários, senhas e tokens do transporte são fictícios. Nenhum e-mail é enviado e nenhum dado remoto é criado.

`auth.test.cjs` verifica cadastro por usuário, senha e identificador do navegador, tratamento de limite de tentativas, validação da sessão pelo serviço, persistência, rotação de tokens, saída e troca de identidade durante requisições. `data.test.cjs` verifica a transformação dos objetos, paginação, centavos, lotes de orçamentos, limites, suporte sem e-mail, preservação dos padrões existentes e proteção contra respostas atrasadas de outra conta. Os relatórios JSON são escritos na pasta temporária do sistema.

O transporte em `support/fake-supabase.cjs` simula respostas HTTP. Ele permite verificar a reação do cliente, mas não comprova o isolamento de um banco remoto nem a quota real por IP. A configuração real precisa ser validada com contas diferentes, RLS, grants, proteção do cadastro e tentativas simultâneas no projeto dedicado. As instruções estão em [supabase/README.md](../supabase/README.md).
