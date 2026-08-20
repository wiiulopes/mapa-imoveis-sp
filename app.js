/* ============================================================
   Mapa de Imóveis - São Paulo
   HTML + CSS + JS puros. Persistência em localStorage.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- constantes ---------------- */
  var STORAGE_KEY = "mapa-imoveis-sp:v1";
  var SCHEMA_VERSION = 1;

  var STATUS = {
    none: { key: "none", label: "Sem análise", cls: "", color: "#d7dde5" },
    wip:  { key: "wip",  label: "Em andamento", cls: "s-wip", color: "#f2b21b" },
    no:   { key: "no",   label: "Não aprovado", cls: "s-no",  color: "#e0483f" },
    ok:   { key: "ok",   label: "Aprovado",     cls: "s-ok",  color: "#1fa463" }
  };
  var STATUS_ORDER = ["none", "wip", "no", "ok"];

  /* ---------------- estado ---------------- */
  var db = { version: SCHEMA_VERSION, updatedAt: null, cities: {} };
  var cityIndex = {};        // code -> { code, name, meso, micro, cx, cy }
  var pathByCode = {};       // code -> <path>
  var activeFilters = {};    // status -> bool (vazio = mostra tudo)
  var currentCode = null;
  var editingId = null;

  /* ---------------- utilidades ---------------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  function money(v) { return (v === null || v === undefined || isNaN(v)) ? "—" : brl.format(v); }

  function uid() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function parseMoney(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim().replace(/[R$\s]/g, "");
    if (!s) return NaN;
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    var n = parseFloat(s);
    return isNaN(n) ? NaN : n;
  }

  // campos numéricos opcionais: devolve null quando vazio, NaN quando inválido
  function parseOptNum(raw, integer) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    var n = integer ? parseMoney(s) : parseMoney(s);
    if (isNaN(n) || n < 0) return NaN;
    return integer ? Math.round(n) : n;
  }

  function num(v) {
    var n = Number(v);
    return (v === null || v === undefined || v === "" || isNaN(n)) ? null : n;
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function safeUrl(u) {
    if (!u) return "";
    var s = String(u).trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    try { var p = new URL(s); return (p.protocol === "http:" || p.protocol === "https:") ? p.href : ""; }
    catch (e) { return ""; }
  }

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  /* ---------------- persistência ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.cities) {
        db = migrate(parsed);
      }
    } catch (e) {
      console.warn("Falha ao ler localStorage:", e);
      toast("Não foi possível ler os dados salvos.");
    }
  }

  function migrate(data) {
    // ponto único para evoluir o schema no futuro
    if (!data.version) data.version = SCHEMA_VERSION;
    Object.keys(data.cities).forEach(function (code) {
      var c = data.cities[code];
      if (!c.properties) c.properties = [];
      if (!c.status) c.status = "none";
      // campos adicionados gradualmente — imóveis antigos ficam com null
      c.properties.forEach(function (p) {
        if (!("area" in p)) p.area = null;
        if (!("bedrooms" in p)) p.bedrooms = null;
        if (!("parking" in p)) p.parking = null;
        if (!("condo" in p)) p.condo = null;
        if (!("iptu" in p)) p.iptu = null;
        if (!("visitDate" in p)) p.visitDate = null;
        if (!("rating" in p)) p.rating = null;
      });
    });
    return data;
  }

  function save() {
    db.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      console.error(e);
      toast("Erro ao salvar (armazenamento cheio?).");
    }
  }

  function getCity(code, create) {
    var c = db.cities[code];
    if (!c && create) {
      var meta = cityIndex[code] || {};
      c = db.cities[code] = { code: code, name: meta.name || code, status: "none", properties: [] };
    }
    return c;
  }

  /* ---------------- cálculos ---------------- */
  function avg(list) {
    if (!list.length) return null;
    var s = list.reduce(function (a, b) { return a + b; }, 0);
    return s / list.length;
  }

  function summary(code) {
    var c = db.cities[code];
    var out = {
      count: 0, rentAvg: null, buyAvg: null, rentN: 0, buyN: 0,
      rentPerM2: null, buyPerM2: null, avgRating: null, status: "none"
    };
    if (!c) return out;
    out.status = c.status || "none";
    out.count = c.properties.length;
    var rent = [], buy = [], rentM2 = [], buyM2 = [], ratings = [];
    c.properties.forEach(function (p) {
      var v = Number(p.value);
      if (isNaN(v)) return;
      if (p.type === "rent") rent.push(v); else buy.push(v);

      // R$/m² médio
      var area = Number(p.area);
      if (!isNaN(area) && area > 0) {
        var perM2 = v / area;
        if (p.type === "rent") rentM2.push(perM2); else buyM2.push(perM2);
      }

      // nota média
      var rating = Number(p.rating);
      if (!isNaN(rating) && rating >= 0) ratings.push(rating);
    });
    out.rentN = rent.length; out.buyN = buy.length;
    out.rentAvg = avg(rent); out.buyAvg = avg(buy);
    out.rentPerM2 = avg(rentM2); out.buyPerM2 = avg(buyM2);
    out.avgRating = avg(ratings);
    return out;
  }

  /* ---------------- render do mapa ---------------- */
  function paint(code) {
    var el = pathByCode[code];
    if (!el) return;
    var st = (db.cities[code] && db.cities[code].status) || "none";
    el.classList.remove("s-wip", "s-no", "s-ok");
    if (STATUS[st].cls) el.classList.add(STATUS[st].cls);
    applyFilterTo(el, st);
    updateCityLabel(code);
  }

  function updateCityLabel(code) {
    var label = document.getElementById("label-" + code);
    if (!label) return;
    var st = (db.cities[code] && db.cities[code].status) || "none";
    label.setAttribute("fill", STATUS[st].color);
  }

  function renderLabels() {
    var labelsGroup = document.getElementById("city-labels");
    if (labelsGroup) labelsGroup.remove();

    labelsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    labelsGroup.setAttribute("id", "city-labels");
    labelsGroup.setAttribute("pointer-events", "none");

    Object.keys(cityIndex).forEach(function (code) {
      var meta = cityIndex[code];
      var st = (db.cities[code] && db.cities[code].status) || "none";

      var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("id", "label-" + code);
      text.setAttribute("x", meta.cx);
      text.setAttribute("y", meta.cy);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("font-size", "10");
      text.setAttribute("font-weight", "bold");
      text.setAttribute("fill", STATUS[st].color);
      text.setAttribute("opacity", "0.8");
      text.textContent = meta.name.length > 12 ? meta.name.substring(0, 12) : meta.name;

      labelsGroup.appendChild(text);
    });

    svg.appendChild(labelsGroup);
  }

  function paintAll() {
    Object.keys(pathByCode).forEach(paint);
    renderCounters();
  }

  function anyFilter() {
    return STATUS_ORDER.some(function (k) { return activeFilters[k]; });
  }

  function applyFilterTo(el, st) {
    if (!anyFilter()) { el.classList.remove("dim"); return; }
    el.classList.toggle("dim", !activeFilters[st]);
  }

  function renderCounters() {
    var counts = { none: 0, wip: 0, no: 0, ok: 0 };
    Object.keys(cityIndex).forEach(function (code) {
      var st = (db.cities[code] && db.cities[code].status) || "none";
      counts[st]++;
    });
    STATUS_ORDER.forEach(function (k) {
      var el = $('#count-' + k);
      if (el) el.textContent = counts[k];
    });
  }

  /* ---------------- tooltip ---------------- */
  var tip = null;
  function showTip(evt, code) {
    if (!tip) tip = $("#tooltip");
    var meta = cityIndex[code];
    if (!meta) return;
    var s = summary(code);
    var st = STATUS[s.status];

    var html = '<div class="t-name">' + esc(meta.name) + "</div>";
    html += '<div class="t-sub">' + esc(meta.micro || meta.meso || "") + "</div>";
    if (s.count) {
      html += '<div class="t-row"><span>Média aluguel</span><b>' + money(s.rentAvg) +
              (s.rentN ? ' <span class="t-sub">(' + s.rentN + ")</span>" : "") + "</b></div>";
      html += '<div class="t-row"><span>Média compra</span><b>' + money(s.buyAvg) +
              (s.buyN ? ' <span class="t-sub">(' + s.buyN + ")</span>" : "") + "</b></div>";
      html += '<div class="t-row"><span>Imóveis</span><b>' + s.count + "</b></div>";
    } else {
      html += '<div class="t-sub" style="margin-top:4px">Clique para cadastrar um imóvel</div>';
    }
    html += '<span class="t-badge" style="background:' + st.color + ';color:' +
            (s.status === "none" || s.status === "wip" ? "#10203a" : "#fff") + '">' + st.label + "</span>";

    tip.innerHTML = html;
    tip.classList.add("show");
    moveTip(evt);
  }

  function moveTip(evt) {
    if (!tip) return;
    var pad = 16;
    var r = tip.getBoundingClientRect();
    var x = evt.clientX + pad;
    var y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function hideTip() { if (tip) tip.classList.remove("show"); }

  /* ---------------- zoom & pan ---------------- */
  var svg, baseView, view;
  function initViewBox() {
    var vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    baseView = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    view = Object.assign({}, baseView);
  }
  function applyView() {
    svg.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);
  }
  function zoomAt(factor, clientX, clientY) {
    var rect = svg.getBoundingClientRect();
    // fator de escala real considerando preserveAspectRatio="xMidYMid meet"
    var scale = Math.min(rect.width / view.w, rect.height / view.h);
    var offX = (rect.width - view.w * scale) / 2;
    var offY = (rect.height - view.h * scale) / 2;
    var ux = view.x + (clientX - rect.left - offX) / scale;
    var uy = view.y + (clientY - rect.top - offY) / scale;

    var nw = view.w / factor, nh = view.h / factor;
    var maxW = baseView.w * 1.2, minW = baseView.w / 40;
    if (nw > maxW) { nw = maxW; nh = baseView.h * (maxW / baseView.w); }
    if (nw < minW) { nw = minW; nh = baseView.h * (minW / baseView.w); }
    view.x = ux - (ux - view.x) * (nw / view.w);
    view.y = uy - (uy - view.y) * (nh / view.h);
    view.w = nw; view.h = nh;
    applyView();
  }
  function resetView() { view = Object.assign({}, baseView); applyView(); }

  function focusCity(code, zoom) {
    var meta = cityIndex[code];
    if (!meta) return;
    if (zoom) {
      view.w = baseView.w / 8; view.h = baseView.h / 8;
    }
    view.x = meta.cx - view.w / 2;
    view.y = meta.cy - view.h / 2;
    applyView();
    $$(".city.selected").forEach(function (e) { e.classList.remove("selected"); });
    if (pathByCode[code]) pathByCode[code].classList.add("selected");
  }

  function bindPanZoom() {
    var wrap = $("#map-wrap");
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;

    wrap.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
    }, { passive: false });

    wrap.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY; ox = view.x; oy = view.y;
      wrap.classList.add("dragging");
    });

    window.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var rect = svg.getBoundingClientRect();
      var scale = Math.min(rect.width / view.w, rect.height / view.h);
      var dx = (e.clientX - sx) / scale, dy = (e.clientY - sy) / scale;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
      view.x = ox - dx; view.y = oy - dy;
      applyView();
    });

    window.addEventListener("mouseup", function () {
      dragging = false;
      wrap.classList.remove("dragging");
      setTimeout(function () { moved = false; }, 0);
    });

    wrap.addEventListener("click", function (e) {
      if (moved) return;
      var t = e.target.closest ? e.target.closest("path.city") : null;
      if (t) openDrawer(t.getAttribute("data-code"));
    });

    $("#zoom-in").addEventListener("click", function () {
      var r = svg.getBoundingClientRect();
      zoomAt(1.4, r.left + r.width / 2, r.top + r.height / 2);
    });
    $("#zoom-out").addEventListener("click", function () {
      var r = svg.getBoundingClientRect();
      zoomAt(1 / 1.4, r.left + r.width / 2, r.top + r.height / 2);
    });
    $("#zoom-reset").addEventListener("click", resetView);
  }

  /* ---------------- drawer (caixa de diálogo) ---------------- */
  function openDrawer(code) {
    currentCode = code;
    editingId = null;
    var meta = cityIndex[code];
    if (!meta) return;

    $("#d-title").textContent = meta.name;
    var regiao = [meta.micro, meta.meso].filter(function (v, i, arr) {
      return v && arr.indexOf(v) === i;
    }).join(" · ");
    $("#d-sub").textContent = (regiao ? regiao + " · " : "") + "IBGE " + code;

    renderStatusPicker();
    renderStats();
    renderList();
    resetForm();

    $("#backdrop").classList.add("show");
    $("#drawer").classList.add("show");
    $$(".city.selected").forEach(function (e) { e.classList.remove("selected"); });
    if (pathByCode[code]) pathByCode[code].classList.add("selected");
    setTimeout(function () { $("#f-desc").focus(); }, 220);
  }

  function closeDrawer() {
    $("#backdrop").classList.remove("show");
    $("#drawer").classList.remove("show");
    $$(".city.selected").forEach(function (e) { e.classList.remove("selected"); });
    currentCode = null;
  }

  function renderStatusPicker() {
    var cur = (db.cities[currentCode] && db.cities[currentCode].status) || "none";
    $("#status-picker").innerHTML = STATUS_ORDER.map(function (k) {
      return '<button type="button" data-status="' + k + '" aria-pressed="' + (k === cur) + '">' +
             '<span class="dot ' + (k === "none" ? "none" : k) + '"></span>' + STATUS[k].label + "</button>";
    }).join("");
  }

  function renderStats() {
    var s = summary(currentCode);
    $("#stats").innerHTML =
      '<div class="stat"><div class="k">Imóveis</div><div class="v">' + s.count + "</div></div>" +
      '<div class="stat"><div class="k">Méd. aluguel</div><div class="v">' + money(s.rentAvg) + "</div></div>" +
      '<div class="stat"><div class="k">Méd. compra</div><div class="v">' + money(s.buyAvg) + "</div></div>";
  }

  function renderList() {
    var c = db.cities[currentCode];
    var list = $("#list");
    if (!c || !c.properties.length) {
      list.innerHTML = '<li class="empty">Nenhum imóvel cadastrado nesta cidade ainda.</li>';
      return;
    }
    list.innerHTML = c.properties.slice().reverse().map(function (p) {
      var url = safeUrl(p.url);
      var specs = [];
      if (num(p.area) !== null) specs.push(p.area + " m²");
      if (num(p.bedrooms) !== null) specs.push(plural(p.bedrooms, "quarto", "quartos"));
      if (num(p.parking) !== null) specs.push(plural(p.parking, "vaga", "vagas"));

      var condo = num(p.condo);
      var extra = "";
      if (condo) {
        var total = Number(p.value) + condo;
        extra = p.type === "rent"
          ? "+ " + money(condo) + " de condomínio · total " + money(total) + "/mês"
          : "+ " + money(condo) + " de condomínio/mês";
      }
      var perM2 = (num(p.area) && Number(p.area) > 0)
        ? money(Number(p.value) / Number(p.area)) + "/m²" : "";

      return '<li class="item" data-id="' + p.id + '">' +
        '<div class="top">' +
          '<span class="tag ' + (p.type === "buy" ? "buy" : "") + '">' + (p.type === "buy" ? "Compra" : "Aluguel") + "</span>" +
          (perM2 ? '<span class="perm2">' + perM2 + "</span>" : "") +
          '<span class="price">' + money(Number(p.value)) + "</span>" +
        "</div>" +
        (specs.length ? '<div class="specs">' + specs.join(" · ") + "</div>" : "") +
        (extra ? '<div class="extra">' + extra + "</div>" : "") +
        (p.description ? "<p>" + esc(p.description) + "</p>" : "") +
        '<div class="links">' +
          (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Abrir anúncio ↗</a>' : "") +
          '<button class="del" data-act="edit" type="button" style="color:var(--brand);margin-left:auto">editar</button>' +
          '<button class="del" data-act="del" type="button" style="margin-left:8px">excluir</button>' +
        "</div>" +
      "</li>";
    }).join("");
  }

  function resetForm() {
    editingId = null;
    $("#f-desc").value = "";
    $("#f-type").value = "rent";
    $("#f-value").value = "";
    $("#f-condo").value = "";
    $("#f-area").value = "";
    $("#f-bedrooms").value = "";
    $("#f-parking").value = "";
    $("#f-iptu").value = "";
    $("#f-visit-date").value = "";
    $("#f-rating").value = "";
    $("#f-url").value = "";
    $("#f-err").textContent = "";
    $("#f-submit").textContent = "Adicionar imóvel";
    $("#f-cancel").hidden = true;
  }

  function submitForm(e) {
    e.preventDefault();
    var desc = $("#f-desc").value.trim();
    var type = $("#f-type").value;
    var value = parseMoney($("#f-value").value);
    var condo = parseOptNum($("#f-condo").value, false);
    var area = parseOptNum($("#f-area").value, false);
    var bedrooms = parseOptNum($("#f-bedrooms").value, true);
    var parking = parseOptNum($("#f-parking").value, true);
    var iptu = parseOptNum($("#f-iptu").value, false);
    var visitDate = $("#f-visit-date").value || null;
    var rating = parseOptNum($("#f-rating").value, false);
    var url = $("#f-url").value.trim();

    if (!desc) { $("#f-err").textContent = "Informe uma descrição."; return; }
    if (isNaN(value) || value <= 0) { $("#f-err").textContent = "Informe um valor válido (ex.: 2500 ou 2.500,00)."; return; }
    if (isNaN(condo)) { $("#f-err").textContent = "Condomínio inválido — use apenas números."; return; }
    if (isNaN(area)) { $("#f-err").textContent = "Área inválida — use apenas números."; return; }
    if (isNaN(bedrooms)) { $("#f-err").textContent = "Quantidade de quartos inválida."; return; }
    if (isNaN(parking)) { $("#f-err").textContent = "Quantidade de vagas inválida."; return; }
    if (isNaN(iptu)) { $("#f-err").textContent = "IPTU inválido — use apenas números."; return; }
    if (isNaN(rating)) { $("#f-err").textContent = "Nota inválida — use números de 0 a 5."; return; }
    if (url && !safeUrl(url)) { $("#f-err").textContent = "O link informado não é uma URL válida."; return; }
    $("#f-err").textContent = "";

    var c = getCity(currentCode, true);
    if (editingId) {
      var p = c.properties.filter(function (x) { return x.id === editingId; })[0];
      if (p) {
        p.description = desc; p.type = type; p.value = value; p.url = url;
        p.condo = condo; p.area = area; p.bedrooms = bedrooms; p.parking = parking;
        p.iptu = iptu; p.visitDate = visitDate; p.rating = rating;
        p.updatedAt = new Date().toISOString();
      }
      toast("Imóvel atualizado.");
    } else {
      c.properties.push({
        id: uid(), description: desc, type: type, value: value, url: url,
        condo: condo, area: area, bedrooms: bedrooms, parking: parking,
        iptu: iptu, visitDate: visitDate, rating: rating,
        createdAt: new Date().toISOString()
      });
      // primeira entrada muda a cidade de "sem análise" para "em andamento"
      if (c.status === "none") c.status = "wip";
      toast("Imóvel adicionado.");
    }

    save();
    paint(currentCode);
    renderCounters();
    renderStatusPicker();
    renderStats();
    renderList();
    resetForm();
    $("#f-desc").focus();
  }

  function formatCurrencyInput(e) {
    var input = e.target;
    var val = input.value.replace(/[^\d,.-]/g, "");

    if (val.indexOf(",") > -1) {
      var parts = val.split(",");
      val = parts[0].replace(/\./g, "") + "," + parts[1];
    } else {
      val = val.replace(/\./g, "");
    }

    input.value = val;
  }

  function formatCurrencyBlur(e) {
    var input = e.target;
    var parsed = parseMoney(input.value);
    if (isNaN(parsed) || parsed === 0) {
      input.value = "";
    } else {
      input.value = parsed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  function formatCurrencyFocus(e) {
    var input = e.target;
    var parsed = parseMoney(input.value);
    if (!isNaN(parsed) && parsed > 0) {
      input.value = parsed.toString().replace(".", ",");
    }
  }

  function bindDrawer() {
    $("#backdrop").addEventListener("click", closeDrawer);
    $("#d-close").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && currentCode) closeDrawer();
    });

    $("#status-picker").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-status]");
      if (!b) return;
      var c = getCity(currentCode, true);
      c.status = b.getAttribute("data-status");
      save();
      paint(currentCode);
      renderCounters();
      renderStatusPicker();
    });

    $("#prop-form").addEventListener("submit", submitForm);
    $("#f-cancel").addEventListener("click", resetForm);

    var valueField = $("#f-value");
    var condoField = $("#f-condo");
    var iptuField = $("#f-iptu");

    valueField.addEventListener("input", formatCurrencyInput);
    valueField.addEventListener("blur", formatCurrencyBlur);
    valueField.addEventListener("focus", formatCurrencyFocus);

    condoField.addEventListener("input", formatCurrencyInput);
    condoField.addEventListener("blur", formatCurrencyBlur);
    condoField.addEventListener("focus", formatCurrencyFocus);

    iptuField.addEventListener("input", formatCurrencyInput);
    iptuField.addEventListener("blur", formatCurrencyBlur);
    iptuField.addEventListener("focus", formatCurrencyFocus);

    $("#list").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-act]");
      if (!btn) return;
      var li = btn.closest("li.item");
      var id = li.getAttribute("data-id");
      var c = db.cities[currentCode];
      if (!c) return;

      if (btn.getAttribute("data-act") === "del") {
        if (!confirm("Excluir este imóvel?")) return;
        c.properties = c.properties.filter(function (p) { return p.id !== id; });
        var wasLast = c.properties.length === 0;
        if (wasLast) {
          // sem imóveis, a cidade volta ao estado inicial (cinza) e sai do storage
          delete db.cities[currentCode];
        }
        save();
        paint(currentCode); renderCounters(); renderStatusPicker(); renderStats(); renderList();
        toast(wasLast ? "Último imóvel excluído — cidade voltou para cinza." : "Imóvel excluído.");
      } else {
        var p = c.properties.filter(function (x) { return x.id === id; })[0];
        if (!p) return;
        editingId = id;
        $("#f-desc").value = p.description || "";
        $("#f-type").value = p.type || "rent";
        $("#f-value").value = String(p.value);
        $("#f-condo").value = num(p.condo) === null ? "" : String(p.condo);
        $("#f-area").value = num(p.area) === null ? "" : String(p.area);
        $("#f-bedrooms").value = num(p.bedrooms) === null ? "" : String(p.bedrooms);
        $("#f-parking").value = num(p.parking) === null ? "" : String(p.parking);
        $("#f-iptu").value = num(p.iptu) === null ? "" : String(p.iptu);
        $("#f-visit-date").value = p.visitDate || "";
        $("#f-rating").value = num(p.rating) === null ? "" : String(p.rating);
        $("#f-url").value = p.url || "";
        $("#f-submit").textContent = "Salvar alterações";
        $("#f-cancel").hidden = false;
        $("#f-desc").focus();
      }
    });
  }

  /* ---------------- busca ---------------- */
  function bindSearch() {
    var input = $("#search");
    var dl = $("#city-options");
    dl.innerHTML = Object.keys(cityIndex).map(function (code) {
      return '<option value="' + esc(cityIndex[code].name) + '" data-code="' + code + '"></option>';
    }).join("");

    function go() {
      var v = input.value.trim().toLowerCase();
      if (!v) return;
      var found = Object.keys(cityIndex).filter(function (code) {
        return cityIndex[code].name.toLowerCase() === v;
      })[0] || Object.keys(cityIndex).filter(function (code) {
        return cityIndex[code].name.toLowerCase().indexOf(v) === 0;
      })[0];
      if (!found) { toast("Cidade não encontrada."); return; }
      focusCity(found, true);
      openDrawer(found);
      input.value = "";
    }

    input.addEventListener("change", go);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  /* ---------------- filtros / legenda ---------------- */
  function bindLegend() {
    $("#legend").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-status]");
      if (!b) return;
      var k = b.getAttribute("data-status");
      activeFilters[k] = !activeFilters[k];
      b.setAttribute("aria-pressed", String(!!activeFilters[k]));
      paintAll();
    });
  }

  /* ---------------- exportar / importar / limpar ---------------- */
  function bindTools() {
    $("#btn-export").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "mapa-imoveis-sp-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast("Backup exportado.");
    });

    $("#file-import").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || !data.cities) throw new Error("formato inválido");
          db = migrate(data);
          save(); paintAll();
          toast("Dados importados.");
        } catch (err) {
          toast("Arquivo inválido.");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });

    $("#btn-import").addEventListener("click", function () { $("#file-import").click(); });

    $("#btn-reset").addEventListener("click", function () {
      if (!confirm("Isso apaga todos os imóveis e status salvos neste navegador. Continuar?")) return;
      db = { version: SCHEMA_VERSION, updatedAt: null, cities: {} };
      localStorage.removeItem(STORAGE_KEY);
      paintAll();
      closeDrawer();
      toast("Dados apagados.");
    });
  }

  /* -------- ranking lateral -------- */
  var rankingVisible = false;
  var heatmapMode = false;

  function renderRanking(type) {
    var list = $("#ranking-list");
    var cities = [];
    Object.keys(db.cities).forEach(function (code) {
      var c = db.cities[code];
      var sum = summary(code);
      var avg = type === "rent" ? sum.rentAvg : sum.buyAvg;
      if (avg !== null) {
        cities.push({ code: code, name: cityIndex[code].name, avg: avg, perM2: type === "rent" ? sum.rentPerM2 : sum.buyPerM2 });
      }
    });
    cities.sort(function (a, b) { return (b.avg || 0) - (a.avg || 0); });
    list.innerHTML = cities.map(function (c) {
      var perM2 = c.perM2 ? " · " + money(c.perM2) + "/m²" : "";
      return '<div class="ranking-item" data-code="' + c.code + '"><div class="name">' + esc(c.name) + '</div><div class="price">' + money(c.avg) + perM2 + '</div></div>';
    }).join("");

    $$(".ranking-item", list).forEach(function (el) {
      el.addEventListener("click", function () {
        focusCity(el.getAttribute("data-code"), true);
        openDrawer(el.getAttribute("data-code"));
      });
    });
  }

  function bindRanking() {
    $("#toggle-ranking").addEventListener("click", function () {
      rankingVisible = !rankingVisible;
      $("#ranking-panel").hidden = !rankingVisible;
      if (rankingVisible) renderRanking("rent");
    });
    $("#close-ranking").addEventListener("click", function () {
      rankingVisible = false;
      $("#ranking-panel").hidden = true;
    });
    $$(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        renderRanking(btn.getAttribute("data-type"));
      });
    });
  }

  /* ---------- heatmap por preço ---------- */
  function getHeatmapColor(value) {
    if (!value) return STATUS.none.color;
    if (value < 2000) return "#90ee90";
    if (value < 3000) return "#ffd700";
    if (value < 4000) return "#ff8c00";
    return "#ff4500";
  }

  function paintHeatmap(code) {
    var el = pathByCode[code];
    if (!el) return;
    if (!heatmapMode) {
      paint(code);
      return;
    }
    var c = db.cities[code];
    var avg = c ? (summary(code).rentAvg || summary(code).buyAvg) : null;
    el.setAttribute("fill", getHeatmapColor(avg));
    el.classList.remove("s-wip", "s-no", "s-ok", "dim");
  }

  function paintAllHeatmap() {
    Object.keys(pathByCode).forEach(paintHeatmap);
  }

  function bindHeatmap() {
    $("#toggle-heatmap").addEventListener("click", function () {
      heatmapMode = !heatmapMode;
      this.style.opacity = heatmapMode ? "1" : "0.6";
      if (heatmapMode) paintAllHeatmap(); else paintAll();
    });
  }

  /* ---------------- inicialização ---------------- */
  function init() {
    svg = document.getElementById("sp-map");
    if (!svg) { console.error("SVG do mapa não encontrado."); return; }

    (window.SP_CITIES || []).forEach(function (c) { cityIndex[c.code] = c; });

    $$("path.city", svg).forEach(function (p) {
      var code = p.getAttribute("data-code");
      pathByCode[code] = p;
      p.setAttribute("tabindex", "0");
      p.addEventListener("mouseenter", function (e) { showTip(e, code); });
      p.addEventListener("mousemove", moveTip);
      p.addEventListener("mouseleave", hideTip);
      p.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(code); }
      });
    });

    load();
    initViewBox();
    bindPanZoom();
    bindDrawer();
    bindSearch();
    bindLegend();
    bindTools();
    bindRanking();
    bindHeatmap();
    paintAll();
    renderLabels();

    $("#total-cities").textContent = Object.keys(cityIndex).length;
    console.log("Mapa pronto:", Object.keys(pathByCode).length, "municípios");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
