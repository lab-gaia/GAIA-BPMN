# Plano de melhorias do GAIA BPMN

## Objetivo

Evoluir o GAIA BPMN para:

- persistir anexos imediatamente após o upload, sem depender do botão **Salvar**;
- disponibilizar em cada **task** os campos **Entrada**, **Saída**, **Recursos necessários**, **Instruções** e os anexos;
- disponibilizar um campo **Descrição** para os demais elementos BPMN, como início, fim, gateways e eventos;
- oferecer a ação **Imprimir** para anexos PDF;
- organizar o catálogo em **Órgão → Subórgão → BPMNs**, permitindo um ou mais BPMNs por subórgão;
- manter autorização, armazenamento, download, importação e exportação BPMN consistentes com o comportamento atual.

## Premissas e decisões de escopo

1. O upload de um anexo será uma operação completa e imediata: ao concluir a requisição, o arquivo e seus metadados já estarão persistidos e aparecerão na interface. O botão **Salvar** continuará sendo usado apenas para alterações de campos editáveis, caso não se opte por autosave desses campos.
2. A gravação imediata será feita no armazenamento de arquivos e no banco de dados, com tratamento de compensação: se a persistência dos metadados falhar depois da gravação do arquivo, o objeto deverá ser removido ou marcado para limpeza.
3. PDFs serão impressos pelo mecanismo do sistema/navegador usando uma visualização ou abertura segura do conteúdo. O arquivo original não será alterado.
4. A descrição será armazenada como metadado da aplicação. A exportação para BPMN só deverá escrever extensões GAIA quando houver uma decisão explícita de compatibilidade com outros editores.
5. A hierarquia organizacional será multiusuário e deverá ser aplicada à autorização e à seleção dos BPMNs. O primeiro desenho deve evitar duplicar BPMN ou arquivo quando um mesmo processo for movido ou recategorizado.
6. O inventário LGPD em `Desktop/Repositorios` será usado como referência de navegação, cadastro, filtros, relacionamentos e permissões; os nomes e regras finais deverão ser validados durante a Fase 0.

## Estado atual relevante

- A API é um monólito modular em ASP.NET Core, com PostgreSQL, Entity Framework Core e armazenamento local.
- O desktop é Electron/React e já possui importação de BPMN, visualização, Input/Output, upload, download e remoção de anexos.
- `ElementAttachment` já grava o arquivo antes de retornar a resposta do endpoint; porém a experiência e o modelo ainda estão centrados em tasks e o plano precisa formalizar o comportamento instantâneo, os estados de erro e a impressão.
- O modelo atual é single-tenant: `Process` não possui vínculo com órgão/subórgão.
- Os valores atuais de Input/Output são propriedades especiais globais e são espelhados na extensão `gaia:io` do XML.
- O parser já conhece elementos BPMN, mas os contratos de task e os painéis do desktop ainda não expõem descrição geral, recursos ou instruções.

## Fases de execução

### Fase 0 — Descoberta, referência e contrato funcional

**Objetivo:** fechar regras antes das alterações de banco e UI.

- Inspecionar o projeto de inventário LGPD localizado em `Desktop/Repositorios` e registrar os padrões reutilizáveis:
  - telas de cadastro e listagem;
  - relacionamento 1-N;
  - filtros, busca e breadcrumbs;
  - regras de exclusão/arquivamento;
  - papéis e escopo de acesso;
  - convenções visuais e mensagens de validação.
- Confirmar o vocabulário oficial: `Órgão`, `Subórgão`, `BPMN`, `Task`, `Gateway`, `Evento de início` e `Evento de fim`.
- Definir se um BPMN pode estar vinculado a apenas um subórgão por vez e se haverá transferência entre subórgãos.
- Definir limites de arquivo, tipos MIME permitidos, tamanho máximo e retenção de anexos.
- Definir se descrição, recursos e instruções entram na exportação BPMN ou permanecem somente no GAIA.
- Produzir matriz de permissões para Admin/Mestre, Guest/Convidado e futuros escopos por órgão/subórgão.

**Saídas:** contrato funcional aprovado, mapa de telas, matriz de permissões, decisões registradas e critérios de aceite refinados.

### Fase 1 — Modelo organizacional e migração

**Objetivo:** introduzir a hierarquia Órgão → Subórgão → BPMN sem quebrar os dados atuais.

- Criar entidades e tabelas:
  - `organizations`/`orgaos`: identificador, nome, código opcional, ativo, timestamps;
  - `suborganizations`/`suborgaos`: identificador, órgão, nome, código opcional, ativo, timestamps;
  - vínculo obrigatório de `processes` com `suborgao_id`.
- Criar índices e restrições:
  - nome/código únicos no escopo adequado;
  - `suborgao_id` indexado em processos;
  - impedimento de referências a subórgão inexistente;
  - estratégia explícita para exclusão: bloquear enquanto houver BPMNs ou exigir transferência.
- Criar migração de dados legados:
  - cadastrar um órgão e subórgão padrão para os processos existentes, ou deixar os processos em uma fila de classificação, conforme decisão da Fase 0;
  - manter os IDs e arquivos já existentes.
- Atualizar `ProcessResponse`, criação/importação de processo e consultas para incluir a hierarquia.
- Garantir que migrations não sejam aplicadas automaticamente em produção e documentar a ordem de execução.

**Critérios de aceite:**

- nenhum BPMN existente é perdido;
- um subórgão pode possuir vários BPMNs;
- um BPMN não fica associado a dois subórgãos simultaneamente;
- listagens e endpoints não retornam dados fora do escopo autorizado.

### Fase 2 — Metadados de elementos BPMN

**Objetivo:** suportar os campos de negócio em todos os elementos relevantes.

- Adicionar `Description` a `BpmnElement` e aos contratos de leitura/escrita.
- Classificar elementos por tipo, preservando o `ElementType` já identificado no XML.
- Definir o formulário por categoria:
  - **Tasks:** Entrada, Saída, Recursos necessários, Instruções e anexos;
  - **demais elementos:** Descrição e anexos, quando permitido pelo requisito;
  - elementos sem edição de negócio poderão permanecer somente leitura, com justificativa visual.
- Modelar os novos valores usando propriedades tipadas existentes ou uma extensão de metadados bem delimitada:
  - preferir propriedades estáveis (`input`, `output`, `resources`, `instructions`, `description`);
  - evitar criar um dicionário JSON sem validação como substituto do modelo relacional.
- Atualizar o parser/importador para manter metadados já existentes e não apagar valores quando o XML importado não os contiver.
- Definir se os valores serão escritos em extensões GAIA do BPMN e versionar o namespace se necessário.
- Atualizar o endpoint de tasks para retornar todos os campos, ou criar um endpoint de elementos com resposta discriminada por tipo.

**Critérios de aceite:**

- cada task consegue editar e consultar os quatro campos textuais;
- cada elemento não-task relevante consegue editar e consultar descrição;
- reimportação do mesmo BPMN não apaga metadados do GAIA;
- download/exportação mantém os valores conforme a decisão de compatibilidade.

### Fase 3 — Upload imediato e ciclo de vida dos anexos

**Objetivo:** separar anexos do ciclo de edição e tornar explícita a persistência instantânea.

- Manter ou refatorar o endpoint de upload para:
  - validar tamanho, extensão, MIME, nome e conteúdo;
  - gerar chave de armazenamento não previsível e segura;
  - gravar o arquivo;
  - persistir metadados em transação;
  - devolver o anexo criado somente após ambas as etapas concluírem.
- Implementar compensação/limpeza para arquivos órfãos e registrar falhas de forma explícita.
- Garantir que autorização seja verificada pelo elemento, BPMN, subórgão e órgão.
- Ajustar o desktop para:
  - enviar o upload imediatamente;
  - mostrar estado `enviando`, `concluído` e `erro`;
  - atualizar a lista sem exigir **Salvar**;
  - não marcar os campos textuais como alterados por causa do upload;
  - permitir nova tentativa sem duplicação acidental.
- Definir remoção imediata com confirmação e tratamento de falha entre banco e armazenamento.
- Adicionar rotina administrativa/diagnóstica para detectar objetos sem metadados e registros sem objeto.

**Critérios de aceite:**

- fechar ou recarregar a tela após upload não perde o arquivo;
- o botão **Salvar** não é necessário para concluir o upload;
- falhas não criam anexo visível sem arquivo nem arquivo sem possibilidade de limpeza;
- convidado continua podendo visualizar/baixar apenas o que sua permissão permite.

### Fase 4 — Impressão de PDFs

**Objetivo:** permitir impressão segura e previsível de anexos PDF.

- Identificar PDF por MIME validado e, como fallback, por extensão somente quando o conteúdo for validado.
- Adicionar ação **Imprimir** somente para PDFs.
- Escolher a implementação:
  - abrir uma rota de visualização autenticada em janela/modal e chamar `window.print`; ou
  - usar uma janela controlada do Electron com conteúdo temporário e `webContents.print`.
- Não expor a chave física do armazenamento ao cliente.
- Definir comportamento para bloqueio de pop-up, ausência de impressora, cancelamento e PDF muito grande.
- Manter **Baixar** disponível e preservar nome original.
- Testar impressão com PDF de uma e várias páginas, orientação, cancelamento e usuário somente leitura.

### Fase 5 — API e telas de cadastro organizacional

**Objetivo:** disponibilizar a navegação Órgão → Subórgão → BPMNs.

- Criar endpoints protegidos para:
  - listar, criar, editar, ativar/inativar e consultar órgãos;
  - listar, criar, editar, ativar/inativar e consultar subórgãos;
  - listar BPMNs de um subórgão;
  - importar/criar BPMN já dentro de um subórgão;
  - transferir BPMN, se permitido.
- Aplicar validação, paginação, ordenação, busca e mensagens de erro consistentes.
- Criar telas seguindo o padrão do inventário LGPD:
  - lista de órgãos;
  - detalhe do órgão com subórgãos;
  - lista/detalhe de BPMNs do subórgão;
  - seletor de contexto antes da importação;
  - breadcrumbs e filtros.
- Atualizar Home e navegação para não depender de uma lista global de processos.
- Preservar links/rotas antigas durante a transição, redirecionando para o novo contexto.

### Fase 6 — Edição de elementos e experiência desktop

**Objetivo:** integrar os novos metadados ao visualizador BPMN.

- Expandir o painel atual de task para os campos de Entrada, Saída, Recursos necessários e Instruções.
- Criar painel de elemento genérico para início, fim, gateways e demais tipos suportados, com descrição.
- Indicar visualmente:
  - elemento selecionado;
  - tipo BPMN;
  - campos preenchidos;
  - anexos em upload;
  - alterações locais ainda não salvas.
- Decidir e implementar autosave dos campos textuais ou manter salvamento em lote; em ambos os casos, deixar o estado de persistência claro.
- Adaptar marcadores do diagrama para considerar descrição e novos campos, não apenas Input/Output.
- Garantir acessibilidade de labels, foco, teclado e mensagens de erro.
- Atualizar contratos Zod/TypeScript e invalidar apenas as queries necessárias.

### Fase 7 — Segurança, desempenho e operação

**Objetivo:** tornar a funcionalidade segura e sustentável em produção.

- Revisar autorização em todas as rotas de órgão, subórgão, BPMN, elemento e anexo.
- Validar upload por tamanho, conteúdo, extensão, MIME e nome; impedir path traversal e acesso direto ao storage.
- Adicionar limites de paginação e evitar carregar todos os BPMNs/anexos de um órgão de uma vez.
- Definir logs estruturados para upload, remoção, impressão, transferência e falhas de limpeza, sem registrar conteúdo sensível.
- Criar política de backup para banco e diretório/volume de storage.
- Monitorar objetos órfãos, espaço usado e tempo de resposta de upload/download.
- Revisar retenção e privacidade para informações possivelmente pessoais em anexos.

### Fase 8 — Testes, migração assistida e entrega

**Objetivo:** validar o fluxo completo e liberar por etapas.

- **Domínio:** regras de nomes, vínculos, tipos de elemento e transições de estado.
- **API/integrado:** migrações, autorização por hierarquia, importação, leitura/escrita de metadados, upload imediato, remoção e impressão/visualização.
- **Desktop:** formulários por tipo de elemento, upload sem Salvar, reconsulta após reload, erros, permissões e download.
- **Compatibilidade:** BPMNs antigos, reimportação, exportação, anexos existentes e contas Admin/Guest.
- **E2E:** órgão com vários subórgãos, subórgão com vários BPMNs, dois usuários com escopos diferentes e concorrência em upload/edição.
- Executar `dotnet test backend/BpmnProperties.sln`, build do desktop e, se disponível, testes de UI automatizados.
- Fazer backup antes da migração e executar a migração primeiro em ambiente de homologação.
- Liberar inicialmente para um órgão piloto, acompanhar logs e só então ampliar.

## Ordem recomendada de implementação

1. Fase 0: decisões e referência do inventário LGPD.
2. Fase 1: órgão/subórgão e migração segura.
3. Fase 2: contrato de metadados dos elementos.
4. Fase 3: upload imediato e ciclo de vida dos anexos.
5. Fase 4: impressão de PDFs.
6. Fases 5 e 6: telas de hierarquia e edição no visualizador.
7. Fase 7: endurecimento operacional.
8. Fase 8: testes, piloto e rollout.

Essa ordem permite que as telas sejam construídas sobre contratos estáveis, evita duplicar regras de autorização e garante que os dados legados sejam classificados antes de a navegação passar a depender da hierarquia organizacional.

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Migração de processos legados sem órgão/subórgão | BPMNs invisíveis ou fora do escopo | órgão/subórgão padrão ou fila de classificação; relatório de inconsistências |
| Arquivo salvo sem metadados ou vice-versa | anexos perdidos/órfãos | transação, compensação e rotina de reconciliação |
| Permissão aplicada apenas na interface | exposição de dados | autorização obrigatória na API em todas as rotas |
| Reimportação apagar metadados | perda de trabalho do usuário | upsert sem destruição quando o XML não trouxer extensão GAIA |
| Impressão depender de rota pública | vazamento de PDF | visualização autenticada e URL temporária/stream protegido |
| Grande volume de BPMNs/anexos | lentidão e alto uso de memória | paginação, índices, streaming e consultas projetadas |

## Definição de pronto

A melhoria será considerada pronta quando:

- a hierarquia Órgão → Subórgão → BPMNs estiver migrada e protegida por autorização;
- tasks possuírem Entrada, Saída, Recursos necessários, Instruções e anexos;
- elementos BPMN não-task suportados possuírem Descrição;
- uploads forem persistidos e confirmados sem depender de Salvar;
- PDFs exibirem a ação Imprimir e mantiverem Download;
- importação, reimportação, exportação, permissões e dados legados tiverem testes automatizados;
- documentação de operação, migração, limites de arquivo e backup estiver atualizada.
