# Verificação da integração

O cadastro por usuário e senha foi executado contra o Supabase do Nivela com duas contas temporárias. As contas entraram automaticamente e começaram sem movimentações. Com a primeira, foram registradas uma receita de R$ 100,00 e uma despesa de R$ 12,34. O saldo de R$ 87,66 permaneceu após recarregar, sair e entrar novamente.

A segunda conta não conseguiu consultar, alterar ou excluir as transações da primeira. Uma tentativa de inserir uma meta com o proprietário da outra conta foi rejeitada. As tabelas financeiras também bloquearam acesso anônimo. As permissões reais da RPC de cadastro permitem execução apenas pelo papel administrativo utilizado no servidor.

O limite de cadastro também foi conferido por HTTP real. Três tentativas com um mesmo identificador de navegador chegaram à verificação de usuário já existente; a quarta retornou HTTP 429, com tempo de espera. Uma tentativa de cadastro fora da função foi recusada. As contas e as cinco reservas de tentativa usadas nessa verificação foram removidas ao terminar.

O cliente e o handler possuem 79 testes nativos de Node: 30 de autenticação, 19 de dados e 30 da função Edge. A quota e o trigger foram verificados em 43 casos de PostgreSQL local. Outros 19 cenários de interface usam um transporte simulado, incluindo teclado, temas, fontes, mensagens e layout. A simulação é identificada nos relatórios e não substitui os testes remotos descritos acima.

Para testar os arquivos de interface antes da publicação, o navegador recebeu os arquivos locais sob a origem do Pages e encaminhou as chamadas ao backend real por um transporte com TLS validado. Os resultados incluem cadastro, sessão, persistência e isolamento remoto; as capturas usam apenas dados fictícios de verificação.

O advisor do Supabase informou que `private.signup_attempts` tem RLS sem policies. Isso é intencional: clientes não recebem acesso, o schema privado não está exposto pela Data API e a função administrativa usa o papel de servidor. Referência do aviso: [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Nenhuma policy de acesso público foi criada para eliminar esse aviso informativo.
