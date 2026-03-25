# PLAN-importacao-despesas

## Objetivo
Criar uma funcionalidade de importação de despesas via imagem (print de tabela) utilizando uma API Visual (Gemini), com uma tela de revisão intermediária para correções. Além disso, criar uma **vista/aba dedicada** para estas categorias de despesas (ordenada por `CLASSIFICAÇÃO`), **mantendo a listagem geral atual inalterada**. Também implementar uma área restrita (apenas para `pedro.gui.fialho@gmail.com`) permitindo a inserção manual, edição e exclusão de itens no Supabase.

## Arquitetura e Decisões
- **OCR/Visão via IA**: O sistema enviará a imagem recebida e pedirá o retorno estruturado (JSON) mapeando as colunas da tabela: DATA, CLASSIFICAÇÃO, DESCRIÇÃO, NOME, VALOR, VENCIMENTO, FORMA DE PAGAMENTO.
- **Banco de Dados (Supabase)**: Nova inserção/edição interage com a tabela de despesas.
- **Segurança e Área Restrita**: Trava baseada no e-mail (`pedro.gui.fialho@gmail.com`) avaliada no Frontend/Backend para exibir os controles de modificação, edição e exclusão.

## Fases de Implementação

### 1. Database e Autenticação
- Confirmar/Ajustar esquema da tabela (se já existe ou se precisaremos criar uma com as novas colunas como *Classificação*).
- Implementar checagem do usuário ativo para esconder/mostrar as restrições admin.

### 2. Interface de IA Visual e Revisão
- Desenvolver um uploader de imagem no dashboard.
- Criar a função que chama a API do Gemini com o prompt de extração visual.
- Desenvolver o `ReviewTable`: Tabela intermediária para o usuário corrigir dados da IA e "Confirmar" o envio para o Supabase.

### 3. Tabela Específica e Gestão (Área do Admin)
- Criar uma **aba ou tabela separada** dedicada a exibir essas despesas ("COMPRAS", "OUTROS", "TERCEIROS", "URGENTES"). A *tabela geral* não sofrerá mudanças na ordem e agrupamento.
- Configurar essa nova tabela para ordenar automaticamente pela coluna `CLASSIFICAÇÃO`.
- Adicionar um *Select/Dropdown* no topo desta nova tabela para os filtros.
- Inserir as opções de gestão (botões de Edição e Exclusão) e o botão de "Nova Inserção Manual" nela, atrelados ao admin logado.
