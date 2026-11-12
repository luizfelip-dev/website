# Nivela - Controle Financeiro 📊

**Projeto Final da disciplina de Desenvolvimento de Interfaces (2/2026)**  
**Instituição:** CEUB - Centro Universitário de Brasília  
**Professor:** Dr. Felipe Batista da Silva  
**Aluno:** Luiz Felipe Ribeiro de Mello  

## Sobre o Projeto
O Nivela é um protótipo de dashboard de controle financeiro desenvolvido para o trabalho final (Trabalho A2) de Desenvolvimento de Interfaces. A proposta foi construir uma interface limpa, focada em usabilidade (UI/UX) e acessibilidade, simulando um ambiente real de SaaS.

🔗 **[Acessar o Dashboard (GitHub Pages)](https://luizfelip-dev.github.io/website/)**

## Tecnologias e Conceitos Aplicados
Este projeto foi construído **sem o uso de frameworks** (como Bootstrap ou Tailwind), focando nos fundamentos da Web:
- **HTML5 Semântico:** Estruturação com `<aside>`, `<main>`, `<article>` para facilitar a leitura por leitores de tela.
- **CSS3 Puro (Grid & Flexbox):** Layout responsivo e construção de gráficos visuais (rosca e barras) puramente com CSS (`conic-gradient` e manipulação de alturas).
- **Acessibilidade (WCAG):** 
  - Contraste de cores validado (nível AA).
  - Variáveis de cores no `:root` preparadas para implementação futura do Dark Mode.
  - Hierarquia de fontes e respeito à preferência de movimento reduzido.

## Estrutura do Repositório
Organizei o projeto separando os assets de forma padronizada para manter o código limpo:
```text
website/
├── index.html
├── assets/
│   ├── css/style.css
│   └── fonts/
