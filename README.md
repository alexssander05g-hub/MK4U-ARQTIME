# Controle de Tempo — Trello Power-Up (V1)

Cronometra automaticamente quanto tempo cada card leva para ser concluído, com
**início, conclusão, tempo total, pausas, histórico e múltiplas sessões**. Toda
a contagem é baseada em **timestamps** — não em um contador visual — então o
tempo continua correto mesmo fechando o navegador, desligando o PC ou abrindo o
Trello de outra máquina.

> V1 é **100% client-side** (sem servidor, sem tokens). A arquitetura já está
> preparada para a V2 (dashboard, Google Sheets, relatórios) — veja o final.

---

## Índice

1. [Como funciona (e por quê assim)](#1-como-funciona-e-por-quê-assim)
2. [Limitações da API do Trello — leia isto](#2-limitações-da-api-do-trello--leia-isto)
3. [Estrutura de pastas e o papel de cada arquivo](#3-estrutura-de-pastas-e-o-papel-de-cada-arquivo)
4. [Onde e como os dados são armazenados](#4-onde-e-como-os-dados-são-armazenados)
5. [Permissões necessárias](#5-permissões-necessárias)
6. [Segurança](#6-segurança)
7. [Instalação — hospedar e conectar ao Trello](#7-instalação--hospedar-e-conectar-ao-trello)
8. [Configurar as listas de início e conclusão](#8-configurar-as-listas-de-início-e-conclusão)
9. [Testar localmente](#9-testar-localmente)
10. [Checklist de validação](#10-checklist-de-validação)
11. [Roadmap V2](#11-roadmap-v2)

---

## 1. Como funciona (e por quê assim)

O fluxo do quadro é **A FAZER → EM ANDAMENTO → CONCLUÍDO**.

- Quando o card entra na lista **de início** (ex.: "Em andamento"), abre-se uma
  **sessão** e o cronômetro passa a contar.
- Quando entra na lista **de conclusão** (ex.: "Concluído"), a sessão é
  finalizada e o tempo total é calculado.
- Se um card concluído voltar para "Em andamento", **uma nova sessão** é criada
  sem apagar o histórico anterior — o total é acumulado.

Além do automático, há botões manuais **▶ Iniciar / ⏸ Pausar / ▶ Retomar /
⏹ Finalizar**.

### A decisão de arquitetura central

Três fatos da documentação atual do Trello moldaram todo o projeto:

1. **O Trello não emite evento de "card movido" para Power-Ups sem backend.**
   A forma **oficialmente recomendada** de reagir a movimentos sem servidor é o
   *padrão de reconciliação no badge*: o Trello **re-renderiza o badge do card
   logo após ele mudar de lista**; no callback do `card-badges` lemos a lista
   atual (`t.card('idList')`), comparamos com a última conhecida e reagimos.
   É exatamente isso que `services/tracker.js → reconcile()` faz.

2. **`pluginData` tem limite de 4096 caracteres por card** (8192 no quadro).
   Por isso o modelo de dados é enxuto (timestamps numéricos) e **valores
   derivados — tempo total, tempo pausado — NÃO são gravados**: eles são
   calculados a partir dos timestamps por `computeTotals()`. Uma única fonte de
   verdade, sem risco de divergência.

3. **A seção do verso do card recarrega sozinha a cada `t.set()`.**
   Então, após qualquer ação, o painel "Controle de Tempo" se atualiza de graça.

O cronômetro visual é apenas uma **projeção** do timestamp guardado: o painel
recalcula a cada segundo, mas a verdade está no `pluginData`.

---

## 2. Limitações da API do Trello — leia isto

Seja honesto com as expectativas:

- **Detecção depende de renderização.** Como não há evento de servidor, a
  mudança de lista é detectada **quando alguém com o Power-Up ativo visualiza o
  card** (quadro aberto ou card aberto). Se o card for movido com o quadro
  fechado por todos, a transição é aplicada na **próxima** vez que ele for
  renderizado.
- **Horário do movimento é aproximado.** Registramos o horário da *detecção*
  (usando `card.dateLastActivity` como melhor aproximação quando disponível).
  Para carimbar o **horário exato do movimento no servidor**, seria preciso a
  REST API + webhooks + um backend — o que exige token do usuário. Isso está
  planejado para a **V2** e a arquitetura já isola esse ponto.
- **Concorrência.** O escopo `shared` não é atômico: se duas pessoas mexerem no
  mesmo card ao mesmo tempo, vale a última gravação. Para uso normal de equipe
  isso é irrelevante; gravamos apenas quando algo realmente muda.

Onde não é possível fazer 100% pelo Power-Up puro, a **melhor alternativa
estável** foi escolhida (reconciliação no badge) e a rota "perfeita" (webhooks)
fica documentada para a V2.

---

## 3. Estrutura de pastas e o papel de cada arquivo

```
trello-timetracker/
├── manifest.json              # Descreve o Power-Up (nome, ícone, capabilities, conector).
│                              #   Usado pelo fluxo trello.com/power-up-preview.
├── index.html                 # CONECTOR: carrega a lib do Trello + registra as capabilities.
│
├── src/
│   ├── client.js              # Registra TODAS as capabilities (badges, seção, botões, settings)
│   │                          #   e liga a detecção automática no callback do badge.
│   │
│   ├── services/
│   │   ├── tracker.js         # ★ Máquina de estados PURA: start/pause/resume/finish/reconcile
│   │   │                      #   e computeTotals(). Zero dependência do Trello → testável.
│   │   ├── storage.js         # ÚNICA camada que fala com t.get/t.set (pluginData). Config do
│   │   │                      #   quadro + estado do card + reconcileAndPersist().
│   │   └── exporter.js        # "Costura" da V2: transforma estado em linha de relatório
│   │                          #   (Card|Responsável|Início|Conclusão|Tempo|Projeto). Puro.
│   │
│   ├── utils/
│   │   ├── time.js            # formatDuration / formatDateTime / now — puros.
│   │   ├── businessTime.js    # Cálculo de horas úteis (já funcional; desligado por padrão).
│   │   └── dom.js             # Helpers mínimos de DOM (inserção segura via textContent).
│   │
│   ├── views/
│   │   ├── sectionView.js     # Controla o painel "Controle de Tempo" do verso do card.
│   │   └── settingsView.js    # Controla a tela de configurações (seletores de lista etc.).
│   │
│   └── styles/
│       └── powerup.css        # Visual minimalista, alinhado aos tokens do Trello.
│
├── views/
│   ├── section.html           # Página (iframe) do painel do verso do card.
│   └── settings.html          # Página (iframe) das configurações.
│
├── public/icons/              # SVGs: badge/botões/ícone do manifest.
│
├── package.json               # Só scripts de servidor estático local (SEM dependências).
├── LICENSE                    # MIT.
└── README.md                  # Este arquivo.
```

**Separação em camadas** (o motivo de tudo isso): *domínio* (`tracker`,
`utils`) não conhece o Trello; *IO* (`storage`) é o único que grava; *telas*
(`views`) só apresentam. Assim a V2 reaproveita o domínio sem reescrever nada.

---

## 4. Onde e como os dados são armazenados

Tudo vive no **`pluginData` do próprio Trello** (via `t.set`/`t.get`) — nada sai
para servidores de terceiros.

| O quê | Escopo | Visibilidade | Chave |
|------|--------|--------------|-------|
| Configuração do quadro | `board` | `shared` | `config` |
| Estado de cada card | `card` | `shared` | `tt` |

Usamos `shared` porque é uma ferramenta de **equipe** (todos veem o mesmo
cronômetro). `shared` nunca deve guardar segredos — e aqui não há nenhum.

Formato do estado de um card:

```json
{
  "v": 1,
  "status": "running",
  "lastListId": "…",
  "session": { "startedAt": 1757831535000, "pausedMs": 0, "pauseStartedAt": null },
  "sessions": [ { "startedAt": …, "endedAt": …, "pausedMs": … } ],
  "history": [ { "at": …, "type": "start" } ]
}
```

Timestamps são números (epoch ms) para caber no limite de 4096 chars; o
histórico rotaciona (últimos 60 eventos). Você pode inspecionar os dados de um
card via REST: `GET https://api.trello.com/1/cards/{idCard}/pluginData`.

---

## 5. Permissões necessárias

**V1 não pede nenhuma autorização OAuth.** O Power-Up apenas:

- lê dados que o Trello já entrega ao iframe (nome do card, `idList`, listas do
  quadro via `t.lists('all')`);
- grava seu próprio `pluginData` no card e no quadro.

Nenhum token é solicitado. (A V2, ao enviar para o Google Sheets, precisará de um
token — e usará `t.authorize` + `t.storeSecret`, nunca token fixo no código.)

---

## 6. Segurança

- **Sem tokens/chaves no código.** V1 não usa REST autenticada.
- **XSS:** texto do usuário (ex.: nome do card, nomes de listas) é inserido via
  `textContent` — tratado como texto puro. Para inserir HTML de usuário, o Trello
  oferece `t.safe(html)`; aqui não precisamos.
- **`shared` não guarda segredos.** O Trello inclusive bloqueia gravar chaves
  com cara de segredo (`token`, `secret`…) em `shared`.
- **Para a V2**, segredos (ex.: token do Google/Trello) devem ir em
  `t.storeSecret()` (criptografado no navegador do usuário), nunca em `t.set`.

---

## 7. Instalação — hospedar e conectar ao Trello

O Trello exige que o Power-Up seja servido por **HTTPS**. Escolha uma opção:

### A) GitHub Pages (recomendado, grátis)

1. Suba esta pasta para um repositório no GitHub.
2. **Settings → Pages → Deploy from a branch** → branch `main`, pasta `/root`.
3. Sua URL base será algo como `https://SEU-USUARIO.github.io/trello-timetracker/`.
4. Confirme que abrem no navegador:
   - `…/index.html`
   - `…/manifest.json`

> Vercel, Netlify e Cloudflare Pages funcionam igual: basta subir a pasta como
> site estático. Não há build — é só HTML/JS/CSS.

### B) Registrar o Power-Up no Trello

1. Acesse o **Admin Portal**: https://trello.com/power-ups/admin
2. **Create new Power-Up** (ou **New**). Vincule ao seu Workspace.
3. Em **Basic Information**, no campo **Iframe connector URL**, cole a URL do
   conector: `https://SEU-DOMINIO/…/index.html`.
4. Aba **Capabilities**: ative estas cinco:
   - `card-badges`
   - `card-detail-badges`
   - `card-back-section`
   - `card-buttons`
   - `show-settings`
5. Salve.

### C) Habilitar no quadro

1. Abra seu quadro → **Power-Ups** → aba **Custom** → habilite "Controle de Tempo".
2. Abra as **Configurações** do Power-Up e escolha as listas (próxima seção).

> **Atalho para testar rápido:** em https://trello.com/power-up-preview cole a URL
> do seu `manifest.json` para carregar o Power-Up sem preencher todo o portal.

---

## 8. Configurar as listas de início e conclusão

Os nomes das listas **não** ficam fixos no código — você os escolhe na tela de
configurações, então o mesmo Power-Up serve para quadros diferentes.

1. No quadro, clique no botão de engrenagem do Power-Up (ou **Power-Ups →
   Controle de Tempo → Configurações**).
2. Defina:
   - **Lista que INICIA o cronômetro** (ex.: `EM ANDAMENTO`);
   - **Lista que FINALIZA o cronômetro** (ex.: `CONCLUÍDO`);
   - **Lista "A fazer"** (opcional — ao voltar para ela, o card é **pausado**,
     sem perder o tempo já contado);
   - **Formato de tempo**, **descontar pausas**, **mostrar badge**;
   - **Contar apenas horas úteis** (+ expediente e dias) — opcional.
3. **Salvar**.

---

## 9. Testar localmente

O Trello precisa de HTTPS público, então localmente use um **túnel**:

```bash
# 1) sirva a pasta estaticamente (escolha um):
npm start                 # usa "npx serve" na porta 5000
# ou
python3 -m http.server 5000

# 2) exponha via HTTPS (escolha um):
npx --yes localtunnel --port 5000
# ou: ngrok http 5000
# ou: cloudflared tunnel --url http://localhost:5000
```

Use a URL HTTPS gerada (ex.: `https://algo.loca.lt/index.html`) como **Iframe
connector URL** no Admin Portal. Recarregue o quadro para ver as mudanças.

A **lógica de domínio** pode ser testada sem o Trello. Um teste rápido:

```bash
node --check src/services/tracker.js   # valida sintaxe
```

(O projeto foi validado com um conjunto de testes das transições, pausas,
sessões, reabertura, detecção automática e horas úteis — todos passando.)

---

## 10. Checklist de validação

| Item | Como validar |
|------|--------------|
| ☑ Power-Up carrega no Trello | aparece em Power-Ups → Custom |
| ☑ Card mostra badge | 🕐/⏸/✓ + tempo na frente do card |
| ☑ Entrar em "EM ANDAMENTO" inicia | mova um card e reabra o quadro |
| ☑ Entrar em "CONCLUÍDO" encerra | badge vira ✓ e fixa o tempo |
| ☑ Tempo correto após fechar o navegador | reabra depois — o tempo continua certo |
| ☑ Pausa funciona | botão ⏸ Pausar; status "Pausado" |
| ☑ Retomar funciona | botão ▶ Retomar; volta a contar |
| ☑ Histórico funciona | seção "Histórico" no verso |
| ☑ Reabertura cria nova sessão | mova de Concluído p/ Em andamento → Sessão 2 |
| ☑ Configuração de listas funciona | escolha listas nas Configurações |
| ☑ Dados permanecem salvos | trocar de máquina mantém tudo (pluginData) |
| ☑ README explica instalação | esta seção 7 |

---

## 11. Roadmap V2

A base foi feita para **não** ser descartável. Pontos de extensão já isolados:

- **Dashboard** (cards concluídos, tempo médio/total, por pessoa, por projeto,
  produtividade semanal/mensal): iterar `t.cards('all')` → `storage.getState` →
  `exporter.toRow` → agregar. Renderizar num `board-button` com popup/iframe.
- **Google Sheets**: mesma `exporter.toRow` gera as linhas
  `Card|Responsável|Início|Conclusão|Tempo|Projeto`; o envio exige um pequeno
  backend + OAuth (token via `t.authorize`/`t.storeSecret`).
- **Relatórios** (tarefas mais demoradas, volume por pessoa, comparação entre
  semanas): consomem os `_raw` de `exporter.toRow` (números crus para agregação).
- **Horário do movimento exato**: webhooks da REST API para carimbar o servidor.

O núcleo (`tracker.js` + `utils`) é puro e já cobre todos esses caminhos sem
reescrita.
