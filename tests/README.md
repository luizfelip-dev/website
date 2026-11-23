# Verificação do cliente

Com Node.js 20 ou mais recente, execute na raiz do repositório:

```bash
node tests/auth.test.cjs
node tests/data.test.cjs
```

Esses testes usam apenas módulos nativos do Node. Não precisam instalar dependências, iniciar um servidor ou conectar um projeto Supabase. Os endereços, usuários, senhas e tokens do transporte são fictícios. Nenhum e-mail é enviado e nenhum dado remoto é criado.

`auth.test.cjs` verifica a validação da sessão pelo serviço, persistência, rotação de tokens, PKCE, saída, falhas e troca de identidade durante requisições. `data.test.cjs` verifica a transformação dos objetos, paginação, centavos, lotes de orçamentos, limites, preservação dos padrões existentes e proteção contra respostas atrasadas de outra conta. Os relatórios JSON são escritos na pasta temporária do sistema.

O transporte em `support/fake-supabase.cjs` simula respostas HTTP. Ele permite verificar a reação do cliente, mas não comprova o isolamento de um banco remoto. A configuração real ainda precisa ser validada com contas diferentes, RLS, grants, confirmação de e-mail e recuperação de senha no projeto dedicado. As instruções estão em [supabase/README.md](../supabase/README.md).
