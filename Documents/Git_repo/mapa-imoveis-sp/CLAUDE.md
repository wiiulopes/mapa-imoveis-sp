# Mapa de Imóveis · São Paulo

Ferramenta pessoal para acompanhar a busca por um imóvel (aluguel ou compra) sobre o mapa dos 645 municípios de SP. Cada cidade tem um status colorido e uma lista de imóveis; o hover mostra as médias de valor.

> Este arquivo é o handoff de uma sessão do Claude (Cowork) onde o projeto foi criado. Leia antes de mexer em qualquer coisa: várias decisões abaixo parecem arbitrárias, mas têm motivo.

---

## Restrições inegociáveis

1. **HTML + CSS + JS puros.** Sem framework, sem bundler, sem npm no runtime, sem CDN. Nada de TypeScript, JSX, Tailwind, React.
2. **Tem que abrir com duplo clique no `index.html`** (protocolo `file://`), sem servidor local.
3. **JS em ES5-ish**, IIFE, `var`, sem módulos ES. Não introduzir `import`/`export` nos arquivos de `site/`.
4. **`fetch()` é proibido para carregar dados locais** — o navegador bloqueia por CORS em `file://`. Por isso a malha do mapa vai embutida no HTML e os metadados vêm por `<script src="cities.js">`.

---

## Estrutura

```
mapa-imoveis/
├─ site/                  ← o que se publica
│  ├─ index.html          ← GERADO. markup + SVG dos 645 municípios inline (~538 KB)
│  ├─ styles.css          ← editar à mão
│  ├─ app.js              ← editar à mão. toda a lógica
│  ├─ cities.js           ← GERADO. window.SP_CITIES: code, name, meso, micro, cx, cy
│  └─ sp-map.svg          ← GERADO. fonte do SVG que entra no index.html
├─ template.html          ← editar à mão. o index.html sem o SVG (marcador <!--SVG-->)
├─ build_map.py           ← gera sp-map.svg + cities.js a partir da malha do IBGE
├─ test.mjs               ← e2e: fluxo base (Playwright)
├─ test2.mjs              ← e2e: campos extras + reset de cor + retrocompatibilidade
└─ PLANO.md               ← documento de planejamento, fases e roadmap
```

### ⚠️ `site/index.html` é gerado — não edite direto

Edite **`template.html`** e regenere. Qualquer alteração feita direto no `index.html` é perdida no próximo build:

```bash
python3 - <<'EOF'
svg = open('site/sp-map.svg', encoding='utf-8').read()
tpl = open('template.html', encoding='utf-8').read()
open('site/index.html','w',encoding='utf-8').write(tpl.replace('<!--SVG-->', svg))
EOF
```

`styles.css`, `app.js` e `cities.js` são carregados por tag, então mudanças neles valem na hora, sem rebuild.

---

## Modelo de dados

`localStorage`, chave `mapa-imoveis-sp:v1`.

```json
{
  "version": 1,
  "updatedAt": "2026-08-18T21:00:00.000Z",
  "cities": {
    "3509502": {
      "code": "3509502",
      "name": "Campinas",
      "status": "wip",
      "properties": [{
        "id": "pm1a2b3c4",
        "description": "Apto reformado no Cambuí",
        "type": "rent",
        "value": 3200,
        "condo": 450,
        "area": 80,
        "bedrooms": 3,
        "parking": 2,
        "url": "https://exemplo.com/imovel/123",
        "createdAt": "2026-08-18T21:00:00.000Z",
        "updatedAt": null
      }]
    }
  }
}
```

- `status` ∈ `none` (cinza) · `wip` (amarelo) · `no` (vermelho) · `ok` (verde).
- `type` ∈ `rent` · `buy`.
- **Só cidades tocadas existem em `cities`.** Ausência da chave = cinza / sem análise. As outras ~640 não ocupam espaço.
- `condo`, `area`, `bedrooms`, `parking` são opcionais e valem `null` quando vazios.
- Toda mudança de schema passa por `migrate()` em `app.js`. Foi ela que absorveu a inclusão desses quatro campos sem quebrar dados antigos — **mantenha esse padrão**, há usuário real com dados salvos.

---

## Regras de negócio (não "simplificar" sem perguntar)

1. Cidade começa cinza.
2. Salvar o **primeiro** imóvel promove cinza → amarelo automaticamente.
3. Vermelho e verde são **sempre manuais**, pelo seletor no painel.
4. Excluir o **último** imóvel devolve a cidade para cinza **e remove a chave do `localStorage`** — mesmo que estivesse verde ou vermelha. Excluir um de vários não mexe na cor.
5. **As médias do tooltip usam só `value`, sem somar `condo`.** Isso é deliberado: somar tornaria a média incomparável entre imóveis com e sem condomínio informado. O total mensal (`value + condo`) aparece por imóvel, no card.
6. R$/m² = `value / area`, calculado só quando `area` existe e é > 0.

---

## Como testar

```bash
npm i playwright            # só a lib; o Chromium já está no sistema
node test.mjs               # fluxo base
node test2.mjs              # campos extras, reset de cor, retrocompatibilidade
```

Os testes usam `chromium.launch({ executablePath: ... })` apontando para um Chromium já instalado — **ajuste esse caminho para a sua máquina** (ou troque por `chromium.launch()` depois de rodar `npx playwright install chromium`). `test2.mjs` imprime PASS/FALHOU por asserção e sempre deve terminar com `ERROS DE CONSOLE: nenhum`.

Detalhe que já causou confusão: no `test.mjs`, clicar no centro do polígono de "São Paulo" acerta **Diadema**, que fica desenhada por cima. Para abrir uma cidade específica de forma confiável, use a busca (`#search` + Enter), como faz o `test2.mjs`.

---

## Regerar o mapa

Só é necessário para mudar projeção, detalhe das fronteiras ou tamanho do arquivo.

```bash
npm i ibge-cidades-com-poligonos   # dataset do IBGE; ajuste SRC no build_map.py
python3 build_map.py               # gera site/sp-map.svg e site/cities.js
# depois, reinjete o SVG no index.html (comando acima)
```

Parâmetros no topo do `build_map.py`: `TOL` (tolerância Douglas–Peucker em graus, ~200 m hoje — menor = mais fiel e mais pesado), `W` (largura do viewBox, 1600), `DEC` (casas decimais, 1).

---

## Convenções

- Textos de interface, labels, mensagens e comentários **em português**.
- Valores em BRL via `Intl.NumberFormat('pt-BR')`. O parser de moeda aceita `2500`, `2.500,00` e `R$ 2.500`.
- Todo texto vindo do usuário passa por `esc()` antes de ir para `innerHTML`; URLs passam por `safeUrl()` (força http/https).
- Cores ficam em CSS custom properties no `:root` (`--st-none`, `--st-wip`, `--st-no`, `--st-ok`). Se mudar uma cor, mude também o espelho em `STATUS` no `app.js` (usado pelo badge do tooltip).

---

## Limites conhecidos

- `localStorage` tem ~5 MB por domínio. Não guardar imagens em base64 — só URL.
- SVG simplificado tem precisão de ~200 m nas fronteiras: serve para visualizar, não para medir.
- `localStorage` é por origem: migrar de `file://` para um domínio publicado **não leva os dados**. Exportar antes, importar depois (botões já existem).
- Municípios encravados ficam desenhados por cima; o clique pega o de cima, que é o comportamento correto.

---

## Próximos passos sugeridos

1. Média de **R$/m²** no tooltip, ao lado das médias de valor — a comparação mais honesta entre cidades.
2. Campos de IPTU, data da visita, nota 0–5, contato do corretor.
3. Ranking lateral de cidades por média, com link para focar no mapa.
4. Modo heatmap por faixa de preço, alternável com o modo status.
5. Publicar via GitHub Pages (o site é 100% estático; basta servir a pasta `site/`).
