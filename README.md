# Nivela — Controle Financeiro

Dashboard financeiro desenvolvido por Luiz Felipe com **HTML5 e CSS3**, sem JavaScript, frameworks ou bibliotecas de ícones. Este repositório contém a Etapa 1: uma interface estática e responsiva, com dados demonstrativos de novembro de 2026.

## Acessar

- Endereço do site após ativar o GitHub Pages: https://luizfelip-dev.github.io/website/
- Código: https://github.com/luizfelip-dev/website
- Localmente: abra `index.html` em um navegador. Não é necessário instalar dependências nem executar build.

## Estrutura

```text
website/
├── index.html
├── assets/
│   ├── css/style.css
│   └── fonts/
│       ├── inter-latin-variable.woff2
│       └── OFL.txt
├── .nojekyll
└── README.md
```

## Construção

1. Estrutura semântica e variáveis de cores em `:root`.
2. Layout principal em CSS Grid, com `aside`, navegação, perfil e `main`. Flexbox organiza cabeçalhos, listas e informações internas.
3. Resumo mensal com saldo total, receitas, despesas e resultado líquido. Um `conic-gradient` desenha o gráfico de rosca; `divs` com alturas proporcionais desenham a evolução do saldo.
4. Agenda de contas com status escritos, orçamentos com barras de progresso e três metas de economia. Uma tabela acrescenta detalhes das movimentações.
5. Media queries adaptam os cartões para desktop, tablet e celular. A navegação vira uma faixa horizontal no celular, e a tabela mantém rolagem dentro de sua própria região.

Os quatro commits de implementação seguem as mensagens e a ordem solicitadas. O desenvolvimento é incremental: cada commit contém a parte correspondente da interface.

## Paleta e acessibilidade

| Variável | Cor | Uso |
| --- | --- | --- |
| `--bg-app` | `#F8FAFC` | Fundo do aplicativo |
| `--bg-card` | `#FFFFFF` | Cartões |
| `--text-primary` | `#0F172A` | Títulos e valores |
| `--text-secondary` | `#64748B` | Informações de apoio |
| `--brand` | `#2563EB` | Identidade e navegação |
| `--success` | `#10B981` | Indicadores e progressos positivos |
| `--danger` | `#EF4444` | Alertas de vencimento |
| `--warning` | `#F59E0B` | Atenção aos limites |

O azul transmite organização e confiança. Verde, vermelho e âmbar dão contexto aos valores; os estados também têm rótulos escritos. Tons mais escuros são usados nos textos de status para melhorar o contraste sobre fundos claros.

A página inclui idioma declarado, link para pular a navegação, foco visível, hierarquia de títulos, legendas e descrições dos gráficos, tabela com cabeçalhos e barras com valores acessíveis. A preferência por movimento reduzido é respeitada. Isso não substitui uma auditoria completa de conformidade WCAG.

## Escopo da etapa

Os dados são fixos. Os links do menu levam às seções da própria página. Notificações e suporte abrem com o elemento HTML nativo `details`. Não há cálculos dinâmicos, formulários de cadastro, autenticação ou persistência de dados nesta etapa.

O documento acadêmico de referência descreve o projeto completo, incluindo recursos futuros. Login, carrossel, alternância de tema e JavaScript ficam fora desta entrega, conforme o pedido da Etapa 1.

## Hospedagem

Configure o GitHub Pages para publicar a raiz da branch `main`: **Settings → Pages → Deploy from a branch → main → / (root) → Save**. Caminhos de estilos, fontes e ícones são relativos, compatíveis com o subdiretório `/website/`. O arquivo `.nojekyll` permite servir os arquivos estáticos diretamente.

## Referências e ferramentas

- [MDN: HTML](https://developer.mozilla.org/pt-BR/docs/Web/HTML), [CSS Grid](https://developer.mozilla.org/pt-BR/docs/Web/CSS/CSS_grid_layout), [Flexbox](https://developer.mozilla.org/pt-BR/docs/Web/CSS/CSS_flexible_box_layout) e [conic-gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient).
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- [Documentação do GitHub Pages](https://docs.github.com/pt/pages).
- [Inter](https://github.com/rsms/inter), de Rasmus Andersson, sob SIL Open Font License 1.1. Fonte hospedada localmente, com licença em `assets/fonts/OFL.txt`.
- OpenAI Codex: assistência na implementação e verificação da interface.
- Git e GitHub CLI: versionamento e publicação.

Os ícones SVG são definidos diretamente no HTML. Não há chamadas a CDNs ou serviços de terceiros na página.
