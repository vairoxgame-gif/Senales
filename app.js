(function () {
  "use strict";

  var DATA_URL = "data/signals.json";
  var DEMO = new URLSearchParams(location.search).has("demo");
  if (DEMO) DATA_URL = "data/demo.json";

  var state = { data: null, filter: "todos", settings: loadSettings(), live: {}, liveAt: 0, liveFail: false };

  // ───── utilidades ─────
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
  }
  function loadSettings() {
    var s = { capital: 1000, riesgo: 1 };
    try { var raw = JSON.parse(store("ajustes") || "{}"); if (raw.capital > 0) s.capital = raw.capital; if (raw.riesgo > 0) s.riesgo = raw.riesgo; } catch (e) {}
    return s;
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    var abs = Math.abs(n);
    var dec = d !== undefined ? d : abs >= 1000 ? 2 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
    return Number(n).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function ago(iso) {
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "hace instantes";
    if (mins < 60) return "hace " + mins + " min";
    var h = Math.floor(mins / 60);
    if (h < 48) return "hace " + h + " h " + (mins % 60) + " min";
    return "hace " + Math.floor(h / 24) + " días";
  }
  function fechaVela(t) {
    return new Date(t * 1000).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  var ESTADOS = {
    "comprar": ["Comprar", "buy"], "vender": ["Vender (short)", "sell"],
    "mantener long": ["Mantener long", "hold"], "mantener short": ["Mantener short", "hold"],
    "salir": ["Salir", "sell"], "esperar": ["Esperar", ""]
  };
  function pill(estado) {
    var e = ESTADOS[estado] || [estado, ""];
    return el("span", { class: "pill " + e[1], text: e[0] });
  }
  function spark(serie, cls) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 84 28"); svg.setAttribute("class", "spark"); svg.setAttribute("aria-hidden", "true");
    if (!serie || serie.length < 2) return svg;
    var mn = Math.min.apply(null, serie), mx = Math.max.apply(null, serie), rng = mx - mn || 1;
    var pts = serie.map(function (v, i) { return (i / (serie.length - 1) * 82 + 1).toFixed(1) + "," + (26 - (v - mn) / rng * 24).toFixed(1); }).join(" ");
    var pl = document.createElementNS(ns, "polyline");
    pl.setAttribute("points", pts); pl.setAttribute("fill", "none"); pl.setAttribute("stroke-width", "1.8");
    pl.setAttribute("stroke", cls === "up" ? "var(--up)" : "var(--down)"); pl.setAttribute("stroke-linejoin", "round");
    svg.appendChild(pl);
    return svg;
  }

  // ───── precio en vivo (solo cripto, desde el navegador; la señal sigue decidiéndose al cierre de vela) ─────
  var LIVE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
  var LIVE_MAX_AGE = 3 * 60 * 1000;
  function liveFor(a) {
    var l = state.live[a.ticker];
    return (a.tipo === "cripto" && l && Date.now() - state.liveAt < LIVE_MAX_AGE) ? l : null;
  }
  function liveStatus() {
    var n = document.getElementById("live");
    if (!n || DEMO) return;
    if (state.liveAt && Date.now() - state.liveAt < LIVE_MAX_AGE) { n.textContent = "Cripto en vivo (cada 15 s) · Acciones: último cierre diario"; n.className = "status"; }
    else if (state.liveFail) { n.textContent = "Precio en vivo no disponible: se muestra el último cierre de vela."; n.className = "status stale"; }
  }
  function fetchLive() {
    if (DEMO || document.hidden || !state.data) return;
    var syms = state.data.activos.filter(function (a) { return a.tipo === "cripto"; }).map(function (a) { return a.ticker + "USDT"; });
    if (!syms.length) return;
    var q = "/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(syms));
    (function tryHost(i) {
      if (i >= LIVE_HOSTS.length) { state.liveFail = true; liveStatus(); return; }
      fetch(LIVE_HOSTS[i] + q, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (rows) {
        var got = 0;
        rows.forEach(function (r) {
          var t = r.symbol.replace(/USDT$/, ""), p = parseFloat(r.lastPrice), ch = parseFloat(r.priceChangePercent);
          if (isFinite(p) && p > 0) { state.live[t] = { p: p, ch: isFinite(ch) ? ch : 0 }; got++; }
        });
        if (!got) throw new Error("sin datos");
        state.liveAt = Date.now(); state.liveFail = false;
        liveStatus(); renderList();
      }).catch(function () { tryHost(i + 1); });
    })(0);
  }

  // ───── lista ─────
  function visible(a) {
    if (state.filter === "cripto") return a.tipo === "cripto";
    if (state.filter === "accion") return a.tipo === "accion";
    if (state.filter === "activas") return a.estado !== "esperar";
    return true;
  }
  function renderList() {
    var list = document.getElementById("list");
    list.textContent = "";
    if (!state.data) return;
    if (state.filter === "posiciones") { renderPositions(list); return; }
    var items = state.data.activos.filter(visible);
    if (!items.length) {
      list.appendChild(el("p", { class: "empty", text: state.data.activos.length ? "Ningún activo con ese filtro ahora." : "Todavía no hay datos. Ejecuta el actualizador (ver README)." }));
      return;
    }
    items.forEach(function (a) {
      var lv = liveFor(a);
      var px = lv ? lv.p : a.precio, chg = lv ? lv.ch : a.cambio_pct;
      var dir = chg >= 0 ? "up" : "down";
      var card = el("button", { class: "card", type: "button", "aria-label": a.ticker + ": " + (ESTADOS[a.estado] || [a.estado])[0] }, [
        el("div", {}, [el("span", { class: "tk", text: a.ticker }), el("span", { class: "nm", text: a.nombre })]),
        el("div", { class: "px", text: "$" + fmt(px) }),
        el("div", { class: "meta" }, [
          pill(a.estado),
          el("span", { class: "tag", text: "Tendencia " + a.sesgo }),
          el("span", { class: "tag", text: a.marco }),
          lv ? el("span", { class: "tag live", text: "● en vivo" }) : null,
          a.validada ? null : el("span", { class: "tag", text: "orientativa" }),
          a.obsoleto ? el("span", { class: "tag stale", text: "dato viejo" }) : null
        ]),
        el("div", {}, [el("div", { class: "ch " + dir, text: (chg >= 0 ? "▲ +" : "▼ ") + fmt(chg, 2) + "%" }), spark(a.serie, dir)])
      ]);
      card.addEventListener("click", function () { openSheet(a); });
      list.appendChild(card);
    });
  }

  // ───── detalle ─────
  function sizing(a, dir) {
    var dist = a.indicadores.stop_atr_dist;
    var entry = a.precio;
    var stop = dir === "short" ? entry + dist : entry - dist;
    if (a.posicion === dir && a.stop_movil) stop = a.stop_movil;
    var riskUsd = state.settings.capital * state.settings.riesgo / 100;
    var perUnit = Math.abs(entry - stop);
    var units = perUnit > 0 ? riskUsd / perUnit : 0;
    var notional = units * entry;
    return { entry: entry, stop: stop, riskUsd: riskUsd, units: units, notional: notional, pctCap: notional / state.settings.capital * 100, lev: notional / state.settings.capital };
  }
  function kv(rows) {
    var box = el("div", { class: "kv" });
    rows.forEach(function (r) { box.appendChild(el("span", { text: r[0] })); box.appendChild(el("span", { text: r[1] })); });
    return box;
  }
  function openSheet(a) {
    var c = document.getElementById("sheet-content");
    c.textContent = "";
    var i = a.indicadores;
    c.appendChild(el("h2", { id: "sheet-title", text: a.ticker + " · " + a.nombre }));
    c.appendChild(el("p", { class: "note", text: "Vela " + a.marco + " cerrada: " + fechaVela(a.vela_cierre_t) + " · precio $" + fmt(a.precio) }));
    var lvd = liveFor(a);
    if (lvd) c.appendChild(el("p", { class: "note", text: "Precio en vivo: $" + fmt(lvd.p) + " (informativo: la señal se decide al cierre de la vela, no con este precio)." }));
    c.appendChild(el("div", { class: "row" }, [pill(a.estado), el("span", { class: "tag", text: "Tendencia " + a.sesgo })]));
    if (!a.validada) c.appendChild(el("div", { class: "warnbox", text: "La estrategia no está validada en este activo. Úsalo como referencia, no como señal probada." }));
    if (a.obsoleto) c.appendChild(el("div", { class: "warnbox", text: "No se pudo actualizar este activo; se muestran los últimos datos guardados." }));

    if (a.ultimo_evento) {
      c.appendChild(el("div", { class: "row" }, [el("button", { class: "btn primary", type: "button", text: "Guía paso a paso de la última señal", onclick: function () { openGuide(a); } })]));
    }
    c.appendChild(el("h3", { text: "Estado de la estrategia" }));
    var rows = [["Posición simulada", a.posicion]];
    if (a.posicion !== "fuera") { rows.push(["Entrada", "$" + fmt(a.entrada)]); rows.push(["Stop móvil (4×ATR)", "$" + fmt(a.stop_movil)]); }
    if (a.ultimo_evento) rows.push(["Último evento", a.ultimo_evento.tipo.replace("_", " ") + " · " + fechaVela(a.ultimo_evento.t)]);
    c.appendChild(kv(rows));
    c.appendChild(el("p", { class: "note", text: "Compra: " + a.gatillos.long + ". Venta (short): " + a.gatillos.short + "." }));

    c.appendChild(el("h3", { text: "Indicadores" }));
    c.appendChild(kv([
      ["EMA 50", "$" + fmt(i.ema50)], ["EMA 200", "$" + fmt(i.ema200)], ["RSI 14", fmt(i.rsi14, 1)],
      ["ATR 14", "$" + fmt(i.atr14)], ["MACD / señal", fmt(i.macd, 3) + " / " + fmt(i.macd_senal, 3)],
      ["Canal 20 velas", "$" + fmt(i.canal_inf) + " – $" + fmt(i.canal_sup)]
    ]));

    c.appendChild(el("h3", { text: "Tamaño de posición" }));
    var dirDefault = a.posicion === "short" || (a.posicion === "fuera" && a.sesgo === "bajista") ? "short" : "long";
    var out = el("div", {});
    var sel = el("select", { id: "dir" }, [el("option", { value: "long", text: "Long (compra)" }), el("option", { value: "short", text: "Short (venta)" })]);
    sel.value = dirDefault;
    var cap = el("input", { id: "cap", type: "number", min: "1", step: "any", value: String(state.settings.capital), inputmode: "decimal" });
    var rk = el("input", { id: "rk", type: "number", min: "0.1", max: "5", step: "0.1", value: String(state.settings.riesgo), inputmode: "decimal" });
    function recalc() {
      var capital = parseFloat(cap.value), riesgo = parseFloat(rk.value);
      if (capital > 0) state.settings.capital = capital;
      if (riesgo > 0) state.settings.riesgo = riesgo;
      store("ajustes", JSON.stringify(state.settings));
      var s = sizing(a, sel.value);
      out.textContent = "";
      out.appendChild(kv([
        ["Entrada de referencia", "$" + fmt(s.entry)], ["Stop", "$" + fmt(s.stop)],
        ["Riesgo (pérdida máx.)", "$" + fmt(s.riskUsd, 2)], ["Unidades", fmt(s.units, s.units < 1 ? 6 : 4)],
        ["Valor de la posición", "$" + fmt(s.notional, 2) + " (" + fmt(s.pctCap, 1) + "% del capital)"]
      ]));
      if (s.lev > 1) out.appendChild(el("div", { class: "warnbox", text: "Esta posición supera tu capital (" + fmt(s.lev, 2) + "×). Requiere apalancamiento; el máximo moderado es 3× y aumenta el riesgo de liquidación." }));
      out.appendChild(el("p", { class: "note", text: "Con stop en gap o poca liquidez, la pérdida real puede ser mayor. Ajusta capital y riesgo (1–2% sugerido)." }));
    }
    c.appendChild(el("div", { class: "form" }, [
      el("label", {}, ["Dirección", sel]), el("label", {}, ["Capital (USDT)", cap]),
      el("label", {}, ["Riesgo por operación (%)", rk])
    ]));
    [sel, cap, rk].forEach(function (n) { n.addEventListener("input", recalc); });
    recalc();
    c.appendChild(out);
    c.appendChild(el("p", { class: "note", text: "Información, no asesoría financiera personalizada. Las órdenes las colocas tú." }));
    document.getElementById("sheet").hidden = false;
    document.querySelector(".sheet-close").focus();
  }
  // ───── mis posiciones (solo en este teléfono; nunca se suben al repositorio) ─────
  function loadPos() {
    try { var l = JSON.parse(store("posiciones") || "[]"); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function savePos(list) { store("posiciones", JSON.stringify(list)); }
  function assetOf(tk) { return state.data ? state.data.activos.filter(function (x) { return x.ticker === tk; })[0] : null; }
  function evalPos(pos) {
    var a = assetOf(pos.ticker);
    if (!a) return null;
    var lv = liveFor(a);
    var copy = {}; Object.keys(a).forEach(function (k) { copy[k] = a[k]; });
    if (lv) copy.precio = lv.p;
    return { a: a, live: !!lv, price: copy.precio, ev: Posiciones.evaluar(copy, pos, state.settings) };
  }
  var ACCION_CLASE = { "VENDER": "sell", "TOMAR GANANCIA": "buy", "AÑADIR": "buy", "SUBIR STOP": "hold", "CERCA DEL STOP": "hold", "REVISAR": "hold", "MANTENER": "" };
  function accionPill(txt) { return el("span", { class: "pill " + (ACCION_CLASE[txt] || ""), text: txt }); }
  function qtyTxt(n) { return fmt(n, n < 1 ? 6 : 4).replace(/,?0+$/, ""); }
  function money(n) { return (n >= 0 ? "+$" : "−$") + fmt(Math.abs(n), 2); }
  function signed(n, d) { return (n >= 0 ? "+" : "−") + fmt(Math.abs(n), d === undefined ? 1 : d); }

  function renderPositions(list) {
    var pos = loadPos();
    var top = [el("button", { class: "btn primary", type: "button", text: "＋ Agregar posición", onclick: function () { openPosForm(null); } })];
    top.push(el("button", { class: "btn", type: "button", text: "Pasar a otro dispositivo", onclick: openBackup }));
    if (pos.length) top.push(el("button", { class: "btn", type: "button", text: "Avisos con la app cerrada", onclick: openPosSync }));
    list.appendChild(el("div", { class: "row", style: "margin-top:0" }, top));
    if (!pos.length) {
      list.appendChild(el("p", { class: "empty", text: "Aún no cargaste ninguna posición. Cuando compres, agrégala aquí (activo, cantidad, precio y stop) y la app te dirá si conviene mantener, vender, tomar ganancia o sumar." }));
      return;
    }
    pos.forEach(function (ps) {
      var r = evalPos(ps);
      var pnlPct = r ? r.ev.pl : null;
      var card = el("button", { class: "card", type: "button", "aria-label": ps.ticker + " posición" }, [
        el("div", {}, [el("span", { class: "tk", text: ps.ticker }), el("span", { class: "nm", text: qtyTxt(ps.cantidad) + " u." })]),
        el("div", { class: "px", text: r ? "$" + fmt(r.price) : "sin datos" }),
        el("div", { class: "meta" }, r ? [accionPill(r.ev.accion), el("span", { class: "tag", text: "compra $" + fmt(ps.compra) }), r.live ? el("span", { class: "tag live", text: "● en vivo" }) : el("span", { class: "tag", text: "último cierre" })] : [el("span", { class: "tag stale", text: "activo fuera de la lista" })]),
        el("div", {}, [el("div", { class: "ch " + (pnlPct >= 0 ? "up" : "down"), text: r ? signed(pnlPct) + "%" : "—" })])
      ]);
      card.addEventListener("click", function () { openPosition(ps); });
      list.appendChild(card);
    });
    list.appendChild(el("p", { class: "foot", style: "padding:8px 0", text: "Las acciones usan el último cierre diario: el stop no se vigila durante el día. Pon también una alerta de precio en Lemon." }));
  }

  function openPosition(ps) {
    var c = document.getElementById("sheet-content");
    c.textContent = "";
    var r = evalPos(ps);
    c.appendChild(el("h2", { id: "sheet-title", text: ps.ticker + " · tu posición" }));
    if (!r) {
      c.appendChild(el("div", { class: "warnbox", text: "Este activo no está en la lista de la app, así que no hay datos para evaluarlo." }));
    } else {
      var ev = r.ev, a = r.a;
      c.appendChild(el("p", { class: "note", text: (r.live ? "Precio en vivo" : "Último cierre") + ": $" + fmt(r.price) + (a.obsoleto ? " · dato viejo, no se pudo actualizar" : "") }));
      c.appendChild(el("div", { class: "row" }, [accionPill(ev.accion)]));
      c.appendChild(el("p", { text: ev.motivo }));
      if (!a.validada) c.appendChild(el("div", { class: "warnbox", text: "La estrategia de señales no está validada en este activo. Esta guía se basa en tus niveles y en la tendencia diaria, no en una señal probada." }));
      var riesgoAbierto = ps.cantidad * Math.max(r.price - ev.stop, 0);
      c.appendChild(el("h3", { text: "Tu posición" }));
      c.appendChild(kv([
        ["Cantidad", qtyTxt(ps.cantidad)], ["Precio de compra (por acción)", "$" + fmt(ps.compra)],
        ["Resultado", signed(ev.pl) + "% (" + money(ps.cantidad * (r.price - ps.compra)) + ")"],
        ["Valor actual", "$" + fmt(ps.cantidad * r.price, 2)],
        ["Stop", "$" + fmt(ev.stop)], ["Objetivo 1", "$" + fmt(ev.obj1)], ["Objetivo 2", "$" + fmt(ev.obj2)],
        ["Riesgo abierto hasta el stop", "$" + fmt(riesgoAbierto, 2) + " (" + fmt(riesgoAbierto / state.settings.capital * 100, 1) + "% de tu capital)"]
      ]));
      c.appendChild(el("h3", { text: "Qué hacer ahora" }));
      c.appendChild(el("div", { class: "step" }, [el("ul", { style: "margin-left:18px" }, Posiciones.pasos(ev.accion, ps.ticker).map(function (t) { return el("li", { text: t }); }))]));
    }
    c.appendChild(el("div", { class: "row" }, [
      el("button", { class: "btn", type: "button", text: "Editar", onclick: function () { openPosForm(ps); } }),
      el("button", { class: "btn", type: "button", text: "Eliminar", onclick: function () {
        if (!confirm("¿Eliminar tu posición de " + ps.ticker + " de la app?")) return;
        savePos(loadPos().filter(function (x) { return x.id !== ps.id; })); closeSheet(); renderList();
      } })
    ]));
    c.appendChild(el("p", { class: "note", text: "Solo contempla compras (long). Información, no asesoría financiera personalizada. Las órdenes las colocas tú." }));
    document.getElementById("sheet").hidden = false;
    document.querySelector(".sheet-close").focus();
  }

  function openPosForm(ps) {
    var c = document.getElementById("sheet-content");
    c.textContent = "";
    c.appendChild(el("h2", { id: "sheet-title", text: ps ? "Editar posición" : "Agregar posición" }));
    var activos = state.data ? state.data.activos : [];
    var tk = el("select", { id: "p-tk" }, activos.map(function (a) { return el("option", { value: a.ticker, text: a.ticker + " · " + a.nombre }); }));
    var qty = el("input", { id: "p-qty", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "Ej: 0,167" });
    var buy = el("input", { id: "p-buy", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "Ej: 165,19 (lo que valía 1 acción)" });
    var stp = el("input", { id: "p-stop", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "USD (vacío = 2×ATR)" });
    var o1 = el("input", { id: "p-o1", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "vacío = automático (2R)" });
    var o2 = el("input", { id: "p-o2", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "vacío = automático (3R)" });
    if (ps) { tk.value = ps.ticker; qty.value = ps.cantidad; buy.value = ps.compra; if (ps.stop) stp.value = ps.stop; if (ps.obj1) o1.value = ps.obj1; if (ps.obj2) o2.value = ps.obj2; }
    var err = el("div", { class: "warnbox", hidden: "hidden" });
    function atrNow() { var a = assetOf(tk.value); return a && a.indicadores ? a.indicadores.atr14 : null; }
    c.appendChild(el("div", { class: "form" }, [
      el("label", {}, ["Activo", tk]), el("label", {}, ["Cantidad de acciones (puede ser decimal)", qty]),
      el("label", {}, ["Precio de 1 acción cuando compraste (USD)", buy]), el("label", {}, ["Stop (USD)", stp]),
      el("label", {}, ["Objetivo 1 (USD)", o1]), el("label", {}, ["Objetivo 2 (USD)", o2])
    ]));
    c.appendChild(el("div", { class: "row" }, [
      el("button", { class: "btn", type: "button", text: "Stop corto −5%", onclick: function () { var b = parseFloat(buy.value); if (b > 0) stp.value = (b * 0.95).toFixed(2); } }),
      el("button", { class: "btn", type: "button", text: "Stop amplio 2×ATR", onclick: function () { var b = parseFloat(buy.value), at = atrNow(); if (b > 0 && at) stp.value = (b - 2 * at).toFixed(2); } })
    ]));
    c.appendChild(el("p", { class: "note", text: "Cantidad = cuántas acciones tienes. Precio = lo que valía UNA acción cuando compraste (no el total invertido). Los objetivos vacíos se calculan solos a 2R y 3R del stop." }));
    // calculadora para quien paga en pesos (Lemon)
    var ars = el("input", { id: "p-ars", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "Pesos que pagaste" });
    var fx = el("input", { id: "p-fx", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "Pesos por 1 USD" });
    var calcMsg = el("p", { class: "note", text: "" });
    c.appendChild(el("h3", { text: "¿Pagaste en pesos? Calcula aquí" }));
    c.appendChild(el("div", { class: "form" }, [el("label", {}, ["Monto pagado (ARS)", ars]), el("label", {}, ["Dólar que te aplicaron (ARS/USD)", fx])]));
    c.appendChild(el("div", { class: "row" }, [el("button", { class: "btn", type: "button", text: "Calcular cantidad o precio", onclick: function () {
      var m = parseFloat(ars.value), d = parseFloat(fx.value);
      if (!(m > 0 && d > 0)) { calcMsg.textContent = "Completa los pesos pagados y el dólar que te aplicaron."; return; }
      var usd = m / d, q = parseFloat(qty.value), b = parseFloat(buy.value), txt = "Equivale a US$" + fmt(usd, 2) + ". ";
      if (b > 0 && !(q > 0)) { qty.value = (usd / b).toFixed(6); txt += "Cantidad calculada con tu precio de compra."; }
      else if (q > 0 && !(b > 0)) { buy.value = (usd / q).toFixed(2); txt += "Precio de compra calculado con tu cantidad."; }
      else if (!(q > 0) && !(b > 0)) {
        var a0 = assetOf(tk.value);
        if (a0) { buy.value = a0.precio.toFixed(2); qty.value = (usd / a0.precio).toFixed(6); txt += "Usé el último cierre ($" + fmt(a0.precio) + ") como precio de compra: corrígelo si pagaste otro."; }
      } else { txt += "Ya tienes cantidad y precio: comprueba que cantidad × precio sea cercano a ese monto (ahora: US$" + fmt(q * b, 2) + ")."; }
      calcMsg.textContent = txt;
    } })]));
    c.appendChild(calcMsg);
    c.appendChild(el("p", { class: "note", text: "Tu resultado en pesos también depende del dólar: la app mide la acción en dólares. Si el dólar sube, ganarás en pesos más de lo que ves aquí." }));
    c.appendChild(err);
    c.appendChild(el("div", { class: "row" }, [
      el("button", { class: "btn primary", type: "button", text: "Guardar", onclick: function () {
        var q = parseFloat(qty.value), b = parseFloat(buy.value), s = parseFloat(stp.value), x1 = parseFloat(o1.value), x2 = parseFloat(o2.value);
        var msg = "";
        if (!(q > 0)) msg = "La cantidad debe ser mayor que 0.";
        else if (!(b > 0)) msg = "Pon el precio de compra en USD.";
        else if (stp.value && !(s > 0 && s < b)) msg = "El stop debe ser menor que el precio de compra.";
        else if (o1.value && !(x1 > b)) msg = "El objetivo 1 debe ser mayor que el precio de compra.";
        else if (o2.value && !(x2 > (x1 > 0 ? x1 : b))) msg = "El objetivo 2 debe ser mayor que el objetivo 1.";
        if (msg) { err.textContent = msg; err.hidden = false; return; }
        var item = { id: ps ? ps.id : String(Date.now()), ticker: tk.value, cantidad: q, compra: b, stop: s > 0 ? s : null, obj1: x1 > 0 ? x1 : null, obj2: x2 > 0 ? x2 : null };
        var list = loadPos().filter(function (x) { return !ps || x.id !== ps.id; });
        list.push(item); savePos(list);
        state.filter = "posiciones";
        document.querySelectorAll(".tabs button").forEach(function (x) { x.setAttribute("aria-selected", x.dataset.filter === "posiciones" ? "true" : "false"); });
        renderList(); openPosition(item);
      } }),
      el("button", { class: "btn", type: "button", text: "Cancelar", onclick: closeSheet })
    ]));
    document.getElementById("sheet").hidden = false;
    document.querySelector(".sheet-close").focus();
  }

  // ───── respaldo: pasar posiciones entre dispositivos con un código ─────
  var BK_PREFIX = "SENALES1:";
  function exportCode() {
    var data = { capital: state.settings.capital, riesgo: state.settings.riesgo, posiciones: loadPos() };
    return BK_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }
  function parseCode(text) {
    var t = String(text || "").replace(/\s+/g, "");
    if (t.indexOf(BK_PREFIX) !== 0) throw new Error("El código debe empezar con " + BK_PREFIX);
    var d;
    try { d = JSON.parse(decodeURIComponent(escape(atob(t.slice(BK_PREFIX.length))))); } catch (e) { throw new Error("El código está incompleto o cambiado. Cópialo de nuevo."); }
    if (!d || !Array.isArray(d.posiciones)) throw new Error("El código no contiene posiciones.");
    var lista = [];
    d.posiciones.forEach(function (x) {
      var q = Number(x.cantidad), b = Number(x.compra);
      if (typeof x.ticker !== "string" || !/^[A-Z0-9.\-]{1,12}$/.test(x.ticker) || !(q > 0) || !(b > 0)) return;
      var s = Number(x.stop), o1 = Number(x.obj1), o2 = Number(x.obj2);
      lista.push({ id: String(x.id || Date.now() + lista.length), ticker: x.ticker, cantidad: q, compra: b, stop: s > 0 ? s : null, obj1: o1 > 0 ? o1 : null, obj2: o2 > 0 ? o2 : null });
    });
    var cap = Number(d.capital), rk = Number(d.riesgo);
    return { lista: lista, capital: cap > 0 ? cap : null, riesgo: rk > 0 ? rk : null };
  }
  function applyImport(res, modo) {
    var actual = loadPos(), final;
    if (modo === "reemplazar") {
      final = res.lista;
      if (res.capital) state.settings.capital = res.capital;
      if (res.riesgo) state.settings.riesgo = res.riesgo;
      store("ajustes", JSON.stringify(state.settings));
    } else {
      var ids = {}; res.lista.forEach(function (x) { ids[x.id] = x; });
      final = actual.map(function (x) { return ids[x.id] || x; });
      res.lista.forEach(function (x) { if (!actual.some(function (y) { return y.id === x.id; })) final.push(x); });
    }
    savePos(final);
    return final.length;
  }
  function openBackup() {
    var c = document.getElementById("sheet-content");
    c.textContent = "";
    c.appendChild(el("h2", { id: "sheet-title", text: "Pasar a otro dispositivo" }));
    c.appendChild(el("p", { text: "Tus posiciones viven solo en este navegador. Para verlas en otro (por ejemplo del teléfono a la PC), usa un código." }));
    c.appendChild(el("h3", { text: "1 · En el dispositivo que ya las tiene" }));
    var out = el("textarea", { readonly: "readonly", rows: "4", style: "width:100%;font:12px monospace;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px" });
    out.value = exportCode();
    var m1 = el("p", { class: "note", text: "" });
    c.appendChild(out);
    c.appendChild(el("div", { class: "row" }, [el("button", { class: "btn primary", type: "button", text: "Copiar código", onclick: function () {
      out.select();
      if (navigator.clipboard) navigator.clipboard.writeText(out.value).then(function () { m1.textContent = "Copiado. Envíatelo a ti mismo (por ejemplo, un mensaje a ti en WhatsApp)."; }, function () { m1.textContent = "Mantén pulsado el texto para copiarlo."; });
    } })]));
    c.appendChild(m1);
    c.appendChild(el("h3", { text: "2 · En el dispositivo nuevo" }));
    var inp = el("textarea", { rows: "4", placeholder: "Pega aquí el código (empieza con " + BK_PREFIX + ")", style: "width:100%;font:12px monospace;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px" });
    var m2 = el("div", { class: "note", text: "" });
    function run(modo) {
      try {
        var res = parseCode(inp.value);
        if (!res.lista.length && modo === "reemplazar" && !confirm("El código no trae posiciones válidas. ¿Reemplazar igual y dejar la lista vacía?")) return;
        if (modo === "reemplazar" && loadPos().length && !confirm("Esto reemplaza las posiciones de este dispositivo. ¿Continuar?")) return;
        var n = applyImport(res, modo);
        m2.textContent = "Listo: ahora hay " + n + " posición(es) en este dispositivo.";
        renderList();
      } catch (e) { m2.textContent = e.message; }
    }
    c.appendChild(inp);
    c.appendChild(el("div", { class: "row" }, [
      el("button", { class: "btn primary", type: "button", text: "Reemplazar todo", onclick: function () { run("reemplazar"); } }),
      el("button", { class: "btn", type: "button", text: "Agregar sin borrar", onclick: function () { run("agregar"); } })
    ]));
    c.appendChild(m2);
    c.appendChild(el("p", { class: "note", text: "El código contiene tus posiciones: no lo publiques. «Reemplazar todo» también copia tu capital y % de riesgo. Cada vez que cambies algo, vuelve a pasar el código." }));
    document.getElementById("sheet").hidden = false;
  }

  function openPosSync() {
    var c = document.getElementById("sheet-content");
    c.textContent = "";
    c.appendChild(el("h2", { id: "sheet-title", text: "Avisos con la app cerrada" }));
    c.appendChild(el("p", { text: "Para que te avisen aunque la app esté cerrada, el servidor necesita conocer tus posiciones. Se guardan en un secreto PRIVADO de GitHub, no en el código público." }));
    var payload = JSON.stringify({ capital: state.settings.capital, riesgo: state.settings.riesgo, posiciones: loadPos().map(function (p) { return { ticker: p.ticker, cantidad: p.cantidad, compra: p.compra, stop: p.stop, obj1: p.obj1, obj2: p.obj2 }; }) });
    var box = el("textarea", { readonly: "readonly", rows: "6", style: "width:100%;font:12px monospace;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px" });
    box.value = payload;
    var msg = el("p", { class: "note", text: "" });
    c.appendChild(el("h3", { text: "Pasos" }));
    c.appendChild(el("div", { class: "step" }, [el("ul", { style: "margin-left:18px" }, [
      "Toca Copiar.", "En GitHub: tu repositorio → Settings → Secrets and variables → Actions.",
      "Crea (o edita) el secreto con nombre POSICIONES y pega el texto como valor.",
      "Repite esto cada vez que agregues, cambies o elimines una posición."
    ].map(function (t) { return el("li", { text: t }); }))]));
    c.appendChild(box);
    c.appendChild(el("div", { class: "row" }, [el("button", { class: "btn primary", type: "button", text: "Copiar", onclick: function () {
      box.select();
      if (navigator.clipboard) navigator.clipboard.writeText(payload).then(function () { msg.textContent = "Copiado."; }, function () { msg.textContent = "Mantén pulsado el texto para copiarlo."; });
    } })]));
    c.appendChild(msg);
    c.appendChild(el("p", { class: "note", text: "Los avisos se evalúan en cada actualización (cada 4 h) con el último cierre. Solo llegan cuando la recomendación cambia, por ejemplo de MANTENER a VENDER." }));
    document.getElementById("sheet").hidden = false;
  }

  function openGuide(a) {
    var g = Guia.buildGuide(a, { capital: state.settings.capital, riesgo: state.settings.riesgo, fmt: fmt, livePrice: (liveFor(a) || {}).p });
    var c = document.getElementById("sheet-content");
    c.textContent = "";
    if (!g) { openSheet(a); return; }
    c.appendChild(el("h2", { id: "sheet-title", text: g.titulo }));
    c.appendChild(el("p", { class: "note", text: "Señal: " + fechaVela(a.ultimo_evento.t) + " · calculado con tu capital de $" + fmt(state.settings.capital, 0) + " y " + fmt(state.settings.riesgo, 1) + "% de riesgo (cámbialos en el detalle del activo)." }));
    c.appendChild(el("h3", { text: "Resumen" }));
    c.appendChild(kv(g.resumen));
    g.avisos.forEach(function (t) { c.appendChild(el("div", { class: "warnbox", text: t })); });
    c.appendChild(el("h3", { text: "Pasos" }));
    g.pasos.forEach(function (p, i) {
      var cb = el("input", { type: "checkbox" });
      var box = el("div", { class: "step" }, [
        el("label", {}, [cb, el("span", { text: "Paso " + (i + 1) + " · " + p.t })]),
        el("ul", {}, p.items.map(function (t) { return el("li", { text: t }); }))
      ]);
      cb.addEventListener("change", function () { box.className = "step" + (cb.checked ? " done" : ""); });
      c.appendChild(box);
    });
    c.appendChild(el("div", { class: "row" }, [el("button", { class: "btn", type: "button", text: "Ver detalle del activo", onclick: function () { openSheet(a); } })]));
    c.appendChild(el("p", { class: "note", text: "Información, no asesoría financiera personalizada. Las órdenes las colocas tú." }));
    document.getElementById("sheet").hidden = false;
    document.querySelector(".sheet-close").focus();
  }
  var pendingOp = null;
  function openOp(ticker, vista) {
    if (!state.data) { pendingOp = { t: ticker, v: vista }; return; }
    if (vista === "pos") {
      var ps = loadPos().filter(function (x) { return x.ticker === ticker; })[0];
      if (ps) { openPosition(ps); return; }
    }
    var a = assetOf(ticker);
    if (a) { if (a.ultimo_evento) openGuide(a); else openSheet(a); }
  }
  var VAPID_PUBLIC = "BHyoM5CzaKbAh1mDO6dQu75LpiFWyZwP1KjkEJ9EBxX94prltZw7L6IdOhqS4HLRM_7SxVwk7_j9Y_snz9IC2Ig";
  function urlB64(t) {
    var pad = "=".repeat((4 - t.length % 4) % 4);
    var raw = atob((t + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function openSettings() {
    var c = document.getElementById("sheet-content");
    c.textContent = "";
    c.appendChild(el("h2", { id: "sheet-title", text: "Ajustes" }));
    c.appendChild(el("h3", { text: "Avisos de compra y venta" }));
    var msg = el("p", { class: "note", text: "" });
    var box = el("textarea", { id: "codigo", readonly: "readonly", rows: "4", style: "width:100%;font:12px monospace;margin-top:8px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px", hidden: "hidden" });
    var okPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    function upd(extra) {
      if (!okPush) { msg.textContent = "Este navegador no admite avisos push. En iPhone, instala la app desde Safari (Añadir a pantalla de inicio, iOS 16.4 o superior) y ábrela desde el ícono."; return; }
      msg.textContent = "Permiso: " + ({ granted: "activado", denied: "bloqueado en el sistema", "default": "sin pedir" }[Notification.permission]) + (extra ? ". " + extra : "");
    }
    function activar() {
      if (!okPush) return;
      Notification.requestPermission().then(function (p) {
        if (p !== "granted") { upd(); return; }
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (s) {
            return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(VAPID_PUBLIC) });
          });
        }).then(function (sub) {
          box.value = JSON.stringify(sub.toJSON());
          box.hidden = false;
          upd("Dispositivo registrado. Copia el código y guárdalo en GitHub (paso siguiente).");
        });
      }).catch(function (e) { upd("No se pudo activar: " + (e && e.message ? e.message : e)); });
    }
    upd();
    c.appendChild(el("div", { class: "row" }, [
      el("button", { class: "btn primary", type: "button", text: "Activar avisos en este dispositivo", onclick: activar }),
      el("button", { class: "btn", type: "button", text: "Copiar código", onclick: function () {
        if (!box.value) { upd("Primero activa los avisos."); return; }
        box.select();
        if (navigator.clipboard) navigator.clipboard.writeText(box.value).then(function () { upd("Código copiado."); }, function () { upd("Mantén pulsado el código para copiarlo."); });
      } })
    ]));
    c.appendChild(el("div", { class: "row" }, [
      el("button", { class: "btn", type: "button", text: "Probar aviso en este dispositivo", onclick: function () {
        if (!okPush || Notification.permission !== "granted") { upd("Primero activa los avisos y acepta el permiso."); return; }
        navigator.serviceWorker.ready.then(function (reg) {
          return reg.showNotification("Prueba de avisos", { body: "Si ves esto, el teléfono puede mostrar avisos de la app.", tag: "prueba", icon: "icons/icon-192.png" });
        }).then(function () { upd("Aviso local enviado. Si no lo ves, revisa las notificaciones del sistema para esta app."); }, function (e) { upd("Error: " + e.message); });
      } })
    ]));
    c.appendChild(msg);
    c.appendChild(box);
    c.appendChild(el("p", { class: "note", text: "Los avisos llegan por el sistema de notificaciones de tu propio navegador, sin apps de terceros. Solo avisan cuando aparece una señal nueva en el cierre de una vela." }));
    c.appendChild(el("h3", { text: "Tema" }));
    var th = el("select", { id: "tema" }, [el("option", { value: "auto", text: "Automático" }), el("option", { value: "light", text: "Claro" }), el("option", { value: "dark", text: "Oscuro" })]);
    th.value = store("tema") || "auto";
    th.addEventListener("change", function () { store("tema", th.value); applyTheme(); });
    c.appendChild(el("div", { class: "form" }, [el("label", {}, ["Apariencia", th])]));
    document.getElementById("sheet").hidden = false;
    document.querySelector(".sheet-close").focus();
  }
  function closeSheet() { document.getElementById("sheet").hidden = true; }
  function applyTheme() {
    var t = store("tema");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }

  // ───── avisos nuevos ─────
  function checkNew(data) {
    var seen = {};
    try { seen = JSON.parse(store("vistos") || "{}"); } catch (e) {}
    var fresh = [];
    data.activos.forEach(function (a) {
      if (!a.nuevo || a.obsoleto || !a.ultimo_evento) return;
      var key = a.ultimo_evento.tipo + "|" + a.ultimo_evento.t;
      if (seen[a.ticker] !== key) { fresh.push(a); seen[a.ticker] = key; }
    });
    store("vistos", JSON.stringify(seen));
    if (!fresh.length) return;
    var b = document.getElementById("banner");
    b.className = "banner ok"; b.hidden = false;
    b.textContent = "Nuevas señales: " + fresh.map(function (a) { return a.ticker + " (" + (ESTADOS[a.estado] || [a.estado])[0] + ")"; }).join(", ");
    if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function (reg) {
        fresh.forEach(function (a) { reg.showNotification(a.ticker + ": " + (ESTADOS[a.estado] || [a.estado])[0], { body: "Precio $" + fmt(a.precio) + " · " + a.marco + ". Informativo, no asesoría.", tag: a.ticker, data: { ticker: a.ticker } }); });
      });
    }
  }

  // ───── carga ─────
  function load() {
    var st = document.getElementById("status");
    fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      state.data = d;
      var old = (Date.now() - new Date(d.generado).getTime()) > 5 * 3600 * 1000;
      st.textContent = (DEMO ? "DATOS DE DEMOSTRACIÓN (sintéticos) · " : "") + "Actualizado " + ago(d.generado) + (d.errores && d.errores.length ? " · " + d.errores.length + " activo(s) con error" : "");
      st.className = "status" + (old || DEMO ? " stale" : "");
      if (!DEMO) checkNew(d);
      renderList();
      fetchLive();
      if (pendingOp) { var po = pendingOp; pendingOp = null; openOp(po.t, po.v); }
    }).catch(function () {
      st.textContent = "Sin conexión o sin datos. Mostrando lo último guardado si existe.";
      st.className = "status stale";
      if (!state.data) renderList();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme();
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.filter = b.dataset.filter;
        document.querySelectorAll(".tabs button").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
        renderList();
      });
    });
    document.getElementById("btn-refresh").addEventListener("click", load);
    document.getElementById("btn-settings").addEventListener("click", openSettings);
    document.querySelectorAll("[data-close]").forEach(function (n) { n.addEventListener("click", closeSheet); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    var op = new URLSearchParams(location.search).get("op");
    var opv = new URLSearchParams(location.search).get("v");
    if (op) { pendingOp = { t: op.toUpperCase(), v: opv }; try { history.replaceState(null, "", location.pathname); } catch (e) {} }
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.op) { load(); openOp(String(e.data.op).toUpperCase(), e.data.v || null); } });
    load();
    setInterval(load, 5 * 60 * 1000);
    setInterval(fetchLive, 15 * 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) fetchLive(); });
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(function () {});
  });
})();
