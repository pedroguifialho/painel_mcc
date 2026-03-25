# PLAN-Importacao.md

## Visão Geral e Objetivo
Refazer a interface e a lógica de importação de dados para o Dashboard Financeiro. A nova interface permitirá importar dados financeiros arrastando arquivos Excel (.xlsx, .xls) ou colando dados de tabelas diretamente (Ctrl+V). Não será utilizado processamento por inteligência artificial, apenas leitura direta de dados tabulados.

## Requisitos
1. **Área Inicial de Importação**:
   - Uma *Dropzone* para arrastar e soltar arquivos do Excel.
   - Um campo de texto para colar os dados (copiados de uma tabela e colados com tabulação).
2. **Tela de Confirmação (Tabela Interativa)**:
   - Após o upload ou a colagem, os dados devem ser exibidos em uma tabela de prévia.
   - A tabela deve permitir edição de células (ajustar descrição, confirmar valores ou datas).
   - Deve ser possível remover linhas específicas.
3. **Consolidação dos Dados**:
   - Um botão "Confirmar Importação" para lançar os dados revisados na planilha geral (Supabase, tabela `payments`).
4. **Dashboard Inalterado**:
   - O filtro de categoria/classificação atual no Dashboard não deve ser afetado.

## Impactos na Tech Stack
Para que o sistema leia nativamente os arquivos Excel (`.xlsx`), será necessário instalar a biblioteca `xlsx` (SheetJS) ou similar via npm.

## Quebra de Tarefas (Workflow)

- [ ] **INPUT**: O usuário faz o upload de um `.xlsx` ou cola texto no textarea.
- [ ] **PROCESSAMENTO**: O sistema usa o pacote `xlsx` (para arquivo) ou faz um split por `\t` e `\n` (para colagem) e estrutura um array de objetos JSON.
- [ ] **OUTPUT (Revisão)**: Componente React listando os objetos JSON em formato de Tabela editável. Os usuários podem alterar campos.
- [ ] **VERIFY**: Quando o usuário clica em "Importar", o sistema valida regras básicas (evitar valor zerado ou data inválida) e faz `supabase.from('payments').insert(...)`.
- [ ] **Atualização Visual**: Concluída a importação, uma notificação de sucesso é mostrada e os dados já refletirão no Painel Diário da aplicação principal.

## Dúvidas Socráticas (Socratic Gate)
Para prosseguirmos sem erros, preciso que me confirme os seguintes pontos da implementação:

1. **Colunas Esperadas:** Quando você for arrastar a planilha ou colar os dados, as colunas sempre virão em uma ordem específica / padrão (ex: Data | Descrição | Valor | Documento)? Há um formato fixo que eu possa pré-programar para a leitura direta?
2. **Instalação de Pacote:** Posso prosseguir executando o comando para instalar o leitor de excel (`npm install xlsx`) neste repositório?
3. **Página ou Aba Modal?** Quer que essa nova tela ocupe o espaço inteiro do dashboard assim que clica em "Importação", substituindo toda a lógica de DDA que havia lá antes?
