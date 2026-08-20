# Mapa de Imóveis · São Paulo — plano de criação

Projeto para acompanhar a busca por um imóvel (aluguel ou compra) usando o mapa dos 645 municípios do estado de São Paulo, com cadastro por cidade e status por cores.

---

## 1. Decisões de arquitetura

| Tema | Decisão | Por quê |
|---|---|---|
| Stack | HTML + CSS + JS puros (sem build, sem framework, sem lib) | Requisito do projeto; abre com duplo clique no `index.html` |
| Mapa | **SVG inline** com um `<path>` por município | Permite colorir e capturar clique/hover com CSS e JS nativos — impossível com `<img>` ou `<object>` |
| Fonte geográfica | Malha municipal do IBGE (pacote npm `ibge-cidades-com-poligonos`) | Dados oficiais, com código IBGE, mesorregião e microrregião |
| Dados por cidade | **Vários imóveis por cidade** | É o que dá sentido à "média de aluguel e compra" no hover |
| Cor | **Status agregado da cidade** (escolhido por você) | O mapa responde "essa cidade está aprovada?", não "esse imóvel está aprovado?" |
| Persistência | `localStorage` (chave `mapa-imoveis-sp:v1`) | Requisito; + exportar/importar JSON como backup |

### Por que não usar `fetch()` para carregar o GeoJSON

Abrindo o site direto do disco (`file://`), o navegador bloqueia `fetch()` por CORS. Por isso a malha vai **embutida no HTML** e os metadados das cidades vêm por `<script src="cities.js">` (tags `<script>`/`<link>` funcionam em `file://`, `fetch` não).

---

## 2. Estrutura de arquivos

```
mapa-imoveis/
├─ site/                  ← o site em si (é só isso que você publica)
│  ├─ index.html          ← markup + SVG dos 645 municípios embutido (~525 KB)
│  ├─ styles.css          ← todo o visual, cores em CSS custom properties
│  ├─ app.js              ← toda a lógica (estado, mapa, drawer, storage)
│  ├─ cities.js           ← window.SP_CITIES: código, nome, região e centróide
│  └─ sp-map.svg          ← o SVG isolado (fonte para regerar o index.html)
├─ build_map.py           ← script que gera sp-map.svg + cities.js a partir do IBGE
├─ template.html          ← index.html sem o SVG (marcador <!--SVG-->)
└─ test.mjs               ← testes de ponta a ponta (Playwright)
```

---

## 3. Modelo de dados (localStorage)

Chave: `mapa-imoveis-sp:v1`

```json
{
  "version": 1,
  "updatedAt": "2026-08-18T21:00:00.000Z",
  "cities": {
    "3509502": {
      "code": "3509502",
      "name": "Campinas",
      "status": "wip",
      "properties": [
        {
          "id": "pm1a2b3c4",
          "description": "Casa 3 dorm, Jardim Chapadão",
          "type": "rent",
          "value": 3200,
          "condo": 450,
          "area": 120,
          "bedrooms": 3,
          "parking": 2,
          "url": "https://exemplo.com/imovel/123",
          "createdAt": "2026-08-18T21:00:00.000Z",
          "updatedAt": null
        }
      ]
    }
  }
}
```

Pontos importantes do modelo:

- **Só cidades tocadas entram no objeto.** As outras 640 e poucas não ocupam espaço; a ausência da chave já significa "sem análise".
- `status` ∈ `none` (cinza) · `wip` (amarelo) · `no` (vermelho) · `ok` (verde).
- `type` ∈ `rent` · `buy` — as médias são calculadas separadamente por tipo.
- `value` é sempre número em reais. O campo aceita `2500`, `2.500,00` ou `R$ 2.500` e normaliza.
- `condo`, `area`, `bedrooms` e `parking` são **opcionais**: ficam `null` quando não preenchidos e simplesmente não aparecem no card.
- `version` existe para permitir migração futura sem perder dados (função `migrate()` em `app.js`). Foi ela que absorveu a inclusão desses quatro campos — registros salvos antes deles continuam abrindo normalmente.

---

## 4. Regras de negócio

**Cores**

1. Toda cidade começa cinza (`none`).
2. Ao salvar o **primeiro** imóvel de uma cidade, ela vira amarela (`wip`) automaticamente.
3. Vermelho e verde são sempre manuais, no seletor de status dentro do painel.
4. Trocar o status não apaga imóveis.
5. Ao excluir o **último** imóvel de uma cidade, ela volta para cinza (`none`) e a chave sai do `localStorage` — mesmo que estivesse marcada como verde ou vermelha. Cidade sem imóvel nenhum é cidade sem análise.

**Médias no hover**

- Média de aluguel = média aritmética dos `value` dos imóveis com `type = "rent"`.
- Média de compra = idem para `type = "buy"`.
- As médias usam sempre o `value`, **sem somar o condomínio** — o total mensal aparece por imóvel, no card.
- Cidade sem imóveis mostra "Clique para cadastrar um imóvel".
- O número entre parênteses é a quantidade de imóveis que entrou naquela média.

**Campos do imóvel**

- Obrigatórios: descrição e valor.
- Opcionais: condomínio, área (m²), quartos, vagas de garagem e link.
- O card calcula sozinho o **R$/m²** (valor ÷ área) e, quando há condomínio em imóvel de aluguel, o **total mensal** (valor + condomínio).

---

## 5. Pipeline do mapa (como o SVG foi gerado)

Rodar de novo só é necessário se você quiser mudar a projeção, o nível de detalhe ou o tamanho do arquivo.

```
IBGE (GeoJSON, 645 municípios)
      ↓ filtra UF = SP
      ↓ simplifica cada anel com Douglas–Peucker (tolerância ~200 m)
      ↓ projeta em Mercator e normaliza para um viewBox 1600 × 1071
      ↓ arredonda coordenadas para 1 casa decimal
      ↓ calcula o centróide de cada município (usado pela busca/zoom)
sp-map.svg (525 KB, 645 <path>)  +  cities.js (84 KB de metadados)
```

Comando: `python3 build_map.py` e depois reinjetar o SVG no `index.html`:

```bash
python3 - <<'EOF'
svg = open('site/sp-map.svg', encoding='utf-8').read()
tpl = open('template.html', encoding='utf-8').read()
open('site/index.html','w',encoding='utf-8').write(tpl.replace('<!--SVG-->', svg))
EOF
```

Parâmetros de ajuste no topo do `build_map.py`: `TOL` (detalhe das fronteiras — menor = mais fiel e mais pesado), `W` (largura do viewBox), `DEC` (casas decimais).

---

## 6. Fases de implementação

### ✅ Fase 0 — Dados (feita)
- [x] Obter a malha municipal oficial dos 645 municípios de SP
- [x] Simplificar, projetar e gerar `sp-map.svg` + `cities.js`

### ✅ Fase 1 — Mapa navegável (feita)
- [x] SVG inline com `data-code` e `data-name` em cada `<path>`
- [x] Zoom por scroll, pan por arraste, botões +/−/enquadrar
- [x] Estados de hover, foco por teclado (Tab + Enter) e cidade selecionada

### ✅ Fase 2 — Cadastro (feita)
- [x] Painel lateral abre ao clicar na cidade
- [x] Formulário: descrição, tipo (aluguel/compra), valor, link
- [x] Campos complementares: condomínio, área (m²), quartos e vagas de garagem
- [x] R$/m² e total mensal calculados automaticamente no card
- [x] Validação de campo obrigatório, valor numérico e URL
- [x] Editar e excluir imóveis já cadastrados

### ✅ Fase 3 — Cores e status (feita)
- [x] Seletor com os 4 status no painel
- [x] Primeiro imóvel promove cinza → amarelo automaticamente
- [x] Excluir o último imóvel devolve a cidade para cinza
- [x] Contadores por status na legenda
- [x] Clicar na legenda filtra o mapa (destaca só aquele status)

### ✅ Fase 4 — Médias no hover (feita)
- [x] Tooltip com nome, região, média de aluguel, média de compra, total e status

### ✅ Fase 5 — Persistência (feita)
- [x] Salvar/ler `localStorage` com schema versionado
- [x] Exportar JSON, importar JSON, limpar tudo (com confirmação)

### ✅ Fase 6 — Verificação (feita)
- [x] Teste de ponta a ponta em Chromium headless: render, cadastro, cores, tooltip, filtro, busca e persistência após reload
- [x] Zero erros de console

### ⬜ Fase 7 — Publicar (opcional, próximo passo)
- [ ] Subir a pasta `site/` num repositório
- [ ] Ativar GitHub Pages (Settings → Pages → branch `main`, pasta `/`) — o site é 100% estático
- [ ] Lembrar: `localStorage` é por navegador **e por domínio**. Ao migrar de `file://` para o Pages, exporte o JSON antes e importe depois.

---

## 7. Como usar

1. Abra `site/index.html` (duplo clique já funciona).
2. Dê zoom com o scroll, arraste para mover; ou digite o nome da cidade na busca e tecle Enter.
3. Clique numa cidade → preencha descrição, tipo, valor e link → **Adicionar imóvel**.
4. A cidade fica amarela. Ajuste para vermelho ou verde conforme sua decisão.
5. Passe o mouse em qualquer cidade preenchida para ver as médias.
6. Use **Exportar** de vez em quando: é o seu backup.

⚠️ Os dados vivem no `localStorage` deste navegador. Limpar dados de navegação apaga tudo — por isso o botão Exportar existe.

---

## 8. Roadmap de evolução

Ideias em ordem de custo/benefício, se você quiser continuar:

1. **Mais campos ainda**: IPTU, data da visita, nota de 0–5, contato do corretor.
2. **Médias por m²** no tooltip, além das médias de valor — é a comparação mais honesta entre cidades.
3. **Ranking lateral**: lista das cidades ordenada por média, com link para focar no mapa.
4. **Anotações por cidade**: campo de texto livre (impressões da visita, contato do corretor).
5. **Cor por faixa de preço**: um segundo modo de visualização (heatmap) alternável com o modo status.
6. **Distância/tempo até um ponto fixo** (o trabalho, por exemplo) — exigiria uma API externa.
7. **Sincronização entre dispositivos**: hoje o `localStorage` é local. O caminho mais barato sem backend é exportar/importar o JSON; com backend, um Supabase ou Firebase resolveria.
8. **Foto do imóvel**: cuidado — imagens em base64 estouram rápido o limite de ~5 MB do `localStorage`. Melhor guardar só a URL da foto.

---

## 9. Limites conhecidos

- `localStorage` tem ~5 MB por domínio. Com campos de texto normais isso comporta milhares de imóveis; com imagens embutidas, não.
- O SVG simplificado tem precisão de ~200 m nas fronteiras — ótimo para visualização, não serve para medição.
- Municípios muito pequenos ficam com poucos pixels no zoom inicial; use a busca ou o zoom para acertar o clique.
- Divisas encravadas (por exemplo Diadema dentro da região de São Paulo) ficam desenhadas por cima — o clique pega o município de cima, que é o comportamento correto.
