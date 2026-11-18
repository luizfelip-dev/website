<div align="center">

  <a href="https://luizfelip-dev.github.io/website/login.html">
    <img src="assets/favicon.svg" alt="Marca do Nivela" width="64" height="64">
  </a>

  <h1>Nivela — Controle Financeiro</h1>

  <p><strong>Mais clareza para o seu dinheiro. Mais espaço para os seus planos.</strong></p>
  <p>Um painel de finanças pessoais feito com HTML, CSS e JavaScript puro.</p>

  <p>
    <img src="docs/readme/tecnologias/html5.svg" alt="HTML5" title="HTML5" width="32" height="32">
    &nbsp;&nbsp;
    <img src="docs/readme/tecnologias/css3.svg" alt="CSS3" title="CSS3" width="32" height="32">
    &nbsp;&nbsp;
    <img src="docs/readme/tecnologias/javascript.svg" alt="JavaScript" title="JavaScript" width="32" height="32">
  </p>

  <p>
    <a href="https://luizfelip-dev.github.io/website/login.html"><strong>Abrir o Nivela ↗</strong></a>
    &nbsp; · &nbsp;
    <a href="#telas-do-projeto">Ver as telas</a>
    &nbsp; · &nbsp;
    <a href="#como-rodar-localmente">Rodar na sua máquina</a>
  </p>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/painel-escuro.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/readme/painel-claro.png">
    <img src="docs/readme/painel-claro.png" alt="Painel do Nivela com resumo financeiro, gráficos de despesas, agenda de contas e orçamentos" width="100%">
  </picture>

</div>

## A ideia por trás do Nivela

Abrir o painel e entender como está o mês, sem precisar procurar cada informação em um lugar diferente. Essa foi a ideia que guiou o Nivela: reunir saldo, despesas, contas e planos em uma interface fácil de consultar.

O projeto nasceu no trabalho final de **Desenvolvimento de Interfaces do CEUB**. Começou com a estrutura em HTML e CSS e foi ganhando filtros, formulários, cálculos e opções de acessibilidade. Tudo foi construído com recursos nativos da web, sem frameworks de interface ou bibliotecas de gráficos.

## O que dá pra fazer

| No Nivela | Como funciona |
| --- | --- |
| **Resumo do mês** | Consultar saldo total, receitas, despesas e resultado líquido, atualizados ao adicionar lançamentos do período. |
| **Contas a pagar e receber** | Alternar entre todas as contas ou filtrar pelas datas de vencimento. |
| **Busca de movimentações** | Combinar filtros de receitas e despesas com uma pesquisa por descrição ou categoria, sem se preocupar com acentos. |
| **Novas transações** | Registrar receita, despesa ou transferência, dividir uma compra em **2 a 24 parcelas** ou repetir um lançamento por **12 meses**. |
| **Orçamentos e metas** | Acompanhar limites por categoria, receber alertas a partir de **80% e 100%** e consultar exemplos de metas de economia. |
| **Educação financeira** | Navegar por dicas com ilustrações próprias, controles de anterior/próximo e pausa da rotação. |
| **Preferências de leitura** | Escolher tema claro ou escuro, ativar alto contraste e ajustar a fonte de **87,5% a 125%**. |
| **Entrada e suporte** | Experimentar o login demonstrativo e um formulário de contato com validação e confirmação local. |

Os lançamentos novos e as preferências ficam salvos no navegador. Você pode recarregar a página ou sair da sessão sem perder esses dados.

## Telas do projeto

O painel tem versões clara e escura, e as opções de leitura também estão disponíveis no login.

<details>
  <summary><strong>Ver login e painel de acessibilidade</strong></summary>

  <br>

  | Entrada | Acessibilidade |
  | :---: | :---: |
  | ![Login do Nivela no tema claro](docs/readme/login.png) | ![Painel de acessibilidade com tema, fonte e alto contraste](docs/readme/acessibilidade.png) |

  As janelas fecham por botão, pela tecla `Esc` ou pelo clique fora. Ao fechar, o foco retorna ao controle que abriu a janela.

</details>

<details>
  <summary><strong>Ver a versão para celular</strong></summary>

  <br>

  <p align="center">
    <img src="docs/readme/mobile.png" alt="Nivela em uma tela de celular, com menu horizontal e cartões reorganizados" width="220">
  </p>

  Os cartões se reorganizam em telas menores. A tabela mantém sua própria rolagem horizontal para não deslocar a página inteira.

</details>

## Por trás da interface

O **HTML5** organiza a navegação, os cartões, os formulários e os modais com elementos semânticos. O **CSS3** cuida do layout em Grid e Flexbox, dos temas e dos gráficos: a rosca usa `conic-gradient`, e as barras variam de altura conforme os dados. O **JavaScript** conecta as interações e atualiza a página sem recarregar.

Algumas escolhas que fazem diferença no uso:

- Os valores são calculados em **centavos inteiros**. Uma compra de R$ 100,00 em três parcelas fica em R$ 33,34 + R$ 33,33 + R$ 33,33, preservando o total.
- Lançamentos do tipo Transferência **não entram em receitas ou despesas** e não alteram o saldo total.
- O resumo considera apenas os lançamentos do mês exibido, incluindo a parcela correspondente ao período.
- Status combinam texto e cor. O foco é visível, as imagens têm descrições e o carrossel respeita `prefers-reduced-motion`.
- A fonte Inter, as ilustrações, os scripts e os estilos são carregados de arquivos locais.

<details>
  <summary><strong>Conhecer a organização dos arquivos</strong></summary>

```text
website/
├── index.html                 # Dashboard
├── login.html                 # Entrada
├── README.md
├── .nojekyll
├── assets/
│   ├── css/
│   │   └── style.css          # Layout, componentes e temas
│   ├── js/
│   │   ├── app.js             # Transações, filtros, cálculos e suporte
│   │   ├── session.js         # Estado de sessão e saída
│   │   ├── login.js           # Formulário de entrada
│   │   ├── carousel.js        # Navegação e pausas das dicas
│   │   └── accessibility.js   # Tema, fonte e contraste
│   ├── img/                   # Ilustrações SVG próprias
│   ├── fonts/                 # Inter e sua licença
│   └── favicon.svg
└── docs/
    └── readme/                # Capturas de tela e ícones das tecnologias
```

</details>

## Como rodar localmente

Com **Git e Python 3** instalados, abra um terminal e execute:

```bash
git clone https://github.com/luizfelip-dev/website.git
cd website
python -m http.server 8000
```

Depois, acesse [localhost:8000/login.html](http://localhost:8000/login.html).

Para testar a entrada, use um **e-mail em formato válido** e uma **senha de teste com pelo menos oito caracteres**. A senha não é armazenada. Não há dependências de front-end para instalar nem etapa de build.

## Sobre esta versão

O Nivela é um **protótipo acadêmico**. O período inicial é novembro de 2026, com dados demonstrativos: a tabela começa com seis registros de exemplo, e o resumo representa uma base mensal maior. Os lançamentos adicionados são somados a essa base.

O login demonstra uma sessão local, sem autenticação em servidor. O link de recuperação apresenta uma orientação, e o suporte confirma o formulário na própria sessão, sem enviar e-mail. As metas e as faturas iniciais são ilustrativas. Os dados deste navegador não são sincronizados com outros dispositivos.

## Próximas ideias

- [ ] Editar e excluir lançamentos já registrados.
- [ ] Escolher outros meses de consulta.
- [ ] Adicionar autenticação real e sincronização de dados entre dispositivos.

## Quem fez

**Autor:** Luiz Felipe Ribeiro de Mello

Trabalho final de **Desenvolvimento de Interfaces (2/2026)**, no **CEUB — Centro Universitário de Brasília**, com o **Prof. Dr. Felipe Batista da Silva**.

[Meu perfil no GitHub ↗](https://github.com/luizfelip-dev)

As capturas mostram o próprio projeto. Os ícones de HTML, CSS e JavaScript vêm do [Devicon](https://github.com/devicons/devicon), com a [licença preservada aqui](docs/readme/tecnologias/LICENSE). A tipografia é a [Inter](https://github.com/rsms/inter), com a licença em [assets/fonts/OFL.txt](assets/fonts/OFL.txt).

---

<p align="center">
  <strong>Nivela</strong><br>
  Mais clareza. Mais possibilidades.<br><br>
  <a href="https://luizfelip-dev.github.io/website/login.html">Conhecer o projeto ↗</a>
</p>
