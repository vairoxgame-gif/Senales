/* Guía de operación: convierte una señal en resumen + pasos para colocar las órdenes.
   Funciones puras (sin DOM) para poder probarlas en Node. */
(function (root) {
  "use strict";

  var STOP_LIMIT_OFFSET = 0.003; // el precio límite del stop-loss va 0,3% más allá del stop

  function buildGuide(a, cfg) {
    var ev = a && a.ultimo_evento;
    if (!ev) return null;
    var f = cfg.fmt;
    var cripto = a.tipo === "cripto";
    var tk = a.ticker;
    var par = cripto ? tk + "/USDT" : tk;
    var tipo = ev.tipo;
    var salida = tipo === "salida_long" || tipo === "salida_short";
    var largo = tipo === "entrada_long" || tipo === "salida_long";
    var unidadTxt = cripto ? tk : "acciones";
    var unitDec = cripto ? 6 : 2;
    var avisos = [];
    var hace = a.vela_cierre_t > ev.t ? Math.round((a.vela_cierre_t - ev.t) / (a.marco === "4h" ? 14400 : 86400)) : 0;
    if (hace > 0) avisos.push("Esta señal es de hace " + hace + (hace === 1 ? " vela" : " velas") + ". Estado actual: " + a.estado + ". Confirma que sigue vigente antes de operar.");
    if (!a.validada) avisos.push("La estrategia NO está validada en este activo. Úsalo como referencia, no como señal probada.");
    var live = cfg.livePrice;

    // ───── cierre ─────
    if (salida) {
      var lado = largo ? "LONG" : "SHORT";
      var pasosS = [
        { t: "Revisa si tienes la operación", items: ["Esta señal solo importa si abriste este " + lado.toLowerCase() + ". Si no lo tienes, no hagas nada."] },
        { t: "Cancela las órdenes pendientes", items: ["Entra a Órdenes abiertas y cancela el stop-loss / OCO / objetivo que dejaste de " + par + "."] },
        { t: "Cierra la operación", items: [largo
          ? "Lado rojo (Vender), pestaña Mercado o Límite cerca de $" + f(a.precio) + ", por todo tu " + tk + " de esta operación."
          : "En Futuros, cierra el short: orden Comprar (solo reducir) a mercado o límite cerca de $" + f(a.precio) + "."] },
        { t: "Anótalo", items: ["Registra precio de salida y resultado en tu registro de señales."] }
      ];
      return {
        titulo: "Cerrar " + lado + " · " + par,
        resumen: [["Señal", "CERRAR " + lado + " (stop móvil tocado)"], ["Precio de referencia", "$" + f(a.precio)], ["Marco", a.marco]],
        avisos: avisos, pasos: pasosS
      };
    }

    // ───── señal antigua: ya no es una entrada, es seguimiento ─────
    if (hace > 0) {
      var eo = a.entrada || a.precio, so = a.stop_movil;
      var res = (largo ? a.precio - eo : eo - a.precio) / eo * 100;
      var sl = largo ? so * (1 - STOP_LIMIT_OFFSET) : so * (1 + STOP_LIMIT_OFFSET);
      var ladoS = largo ? "LONG" : "SHORT";
      avisos.push("Si NO entraste en su momento, no persigas esta señal: espera la próxima.");
      return {
        titulo: "Seguimiento " + ladoS + " · " + par,
        resumen: [
          ["Entrada original", "$" + f(eo)], ["Precio actual (cierre)", "$" + f(a.precio)],
          ["Resultado de la operación", (res >= 0 ? "+" : "") + f(res, 1) + "%"],
          ["Stop móvil actual", "$" + f(so)], ["Estado", a.estado]
        ],
        avisos: avisos,
        pasos: [
          { t: "Solo si tienes esta operación abierta", items: [cripto && largo
            ? "Edita tu stop-loss: Stop Limit con Stop " + f(so) + " y Precio " + f(sl) + " (si aún no tienes uno, colócalo ahora)."
            : "Edita tu stop-loss para que quede en $" + f(so) + "."] },
          { t: "Si no la tienes", items: ["No hagas nada con esta señal. La entrada ya pasó."] },
          { t: "Cierre", items: ["Cuando llegue el aviso CERRAR " + ladoS + ", cancela las órdenes pendientes y cierra la posición."] }
        ]
      };
    }

    // ───── entrada ─────
    var entrada = a.entrada || a.precio;
    var stop = a.stop_movil;
    var r = Math.abs(entrada - stop);
    var sgn = largo ? 1 : -1;
    var t2 = entrada + sgn * 2 * r, t3 = entrada + sgn * 3 * r;
    var distPct = r / entrada * 100;
    var riesgoUsd = cfg.capital * cfg.riesgo / 100;
    var unidades = r > 0 ? riesgoUsd / r : 0;
    var valor = unidades * entrada;
    var stopLimit = largo ? stop * (1 - STOP_LIMIT_OFFSET) : stop * (1 + STOP_LIMIT_OFFSET);
    var atr = a.indicadores && a.indicadores.atr14;
    var callback = atr ? 4 * atr / entrada * 100 : null;
    var unidStr = f(unidades, unitDec);
    var mitad = f(unidades / 2, unitDec);

    if (live && r > 0 && Math.abs(live - entrada) / r > 0.5) {
      avisos.push("El precio en vivo ($" + f(live) + ") ya se alejó " + f(Math.abs(live - entrada) / entrada * 100, 1) + "% de la entrada de la señal. Si se movió más de la mitad de la distancia al stop, mejor no perseguirlo.");
    }
    if (valor > cfg.capital) avisos.push("La posición ($" + f(valor, 2) + ") supera tu capital ($" + f(cfg.capital, 0) + "). Sin apalancamiento no puedes abrirla completa: reduce el riesgo o espera otra señal.");
    if (!largo) avisos.push("En Lemon (contado) NO se puede operar short: aquí significa \"no comprar\" o \"salir si tienes\". Solo se opera en un exchange con Futuros, si tu cuenta lo permite.");

    var resumen = [
      ["Señal", largo ? "COMPRA (long)" : "VENTA (short)"],
      ["Par / marco", par + " · " + a.marco],
      ["Entrada de referencia", "$" + f(entrada)],
      ["Stop-loss", "$" + f(stop) + " (" + (largo ? "−" : "+") + f(distPct, 1) + "%)"],
      ["Objetivo ref. 2R / 3R", "$" + f(t2) + " / $" + f(t3)],
      ["Riesgo (tu " + f(cfg.riesgo, 1) + "% de $" + f(cfg.capital, 0) + ")", "$" + f(riesgoUsd, 2)],
      ["Tamaño", unidStr + " " + unidadTxt],
      ["Valor de la posición", "$" + f(valor, 2) + " (" + f(valor / cfg.capital * 100, 1) + "% del capital)"]
    ];

    var pasos;
    if (!cripto) {
      pasos = [
        { t: "Antes de empezar", items: ["Binance no opera acciones: usa tu bróker de acciones/CEDEARs. Esta señal es orientativa."] },
        { t: "Entrada", items: ["Orden " + (largo ? "de compra" : "de venta en corto, si tu bróker lo permite") + " tipo Límite a $" + f(entrada) + ", cantidad " + unidStr + " acciones."] },
        { t: "Stop-loss", items: ["Orden stop " + (largo ? "de venta" : "de compra") + " con activación en $" + f(stop) + "."] },
        { t: "Objetivo opcional", items: ["Cierra la mitad cerca de $" + f(t2) + " (2R) y deja el resto con el stop."] },
        { t: "Seguimiento y cierre", items: ["Cuando llegue el aviso de CERRAR, cancela las órdenes pendientes y cierra la posición."] }
      ];
    } else if (largo) {
      pasos = [
        { t: "Antes de empezar", items: ["Ten al menos $" + f(valor, 2) + " en USDT disponibles en Binance Spot.", "El mínimo por orden es 5 USDT."] },
        { t: "Entrada (lado verde)", items: ["Pestaña Límite.", "Precio: " + f(entrada), "Monto: " + unidStr + " " + tk + " (Total ≈ " + f(valor, 2) + " USDT).", "Toca Comprar " + tk + "."] },
        { t: "Stop-loss (lado rojo), cuando se ejecute la compra", items: ["Pestaña Stop Limit.", "Stop: " + f(stop), "Precio: " + f(stopLimit) + " (un poco menor que el stop).", "Monto: " + unidStr + " " + tk + ".", "Toca Vender " + tk + ".", "En una caída brusca puede no ejecutarse y perderías más de lo planeado."] },
        { t: "Objetivo (opcional)", items: ["Pestaña Límite, lado rojo: vende " + mitad + " " + tk + " a " + f(t2) + " (2R).", "O usa OCO (stop y objetivo juntos) si aparece en la flecha de Stop Limit."] },
        { t: "Seguimiento", items: ["El stop móvil sube con el precio. Ahora está en $" + f(stop) + ".", "Si en un aviso o en esta app sube, edita tu orden stop al nuevo nivel." + (callback ? " O usa un Trailing Stop con retroceso ≈ " + f(callback, 1) + "%." : "")] },
        { t: "Cierre", items: ["Cuando llegue el aviso CERRAR LONG, cancela la orden stop pendiente y vende lo que tengas."] }
      ];
    } else {
      pasos = [
        { t: "Antes de empezar", items: ["Esto NO se hace en Spot ni en Lemon.", "Necesitas Futuros USDⓈ-M habilitado en tu cuenta, con USDT como garantía.", "Práctica antes con un monto mínimo."] },
        { t: "Preparar la cuenta", items: ["Derivados → Futuros USDⓈ-M → " + tk + "USDT.", "Margen: Aislado.", "Apalancamiento: máximo 3×. Con tu tamaño, rara vez lo necesitarás."] },
        { t: "Entrada (Vender / Short)", items: ["Orden Límite, lado Vender/Short.", "Precio: " + f(entrada), "Cantidad: " + unidStr + " " + tk + "."] },
        { t: "Stop-loss", items: ["Orden Stop de mercado, lado Comprar, marcada \"Solo reducir\".", "Precio de activación: " + f(stop) + " (si sube hasta ahí, cierra)."] },
        { t: "Objetivo (opcional)", items: ["Orden Límite de compra (solo reducir) por " + mitad + " " + tk + " a " + f(t2) + " (2R)."] },
        { t: "Seguimiento y cierre", items: ["Si el stop móvil baja, edita tu stop al nuevo nivel (actual: " + f(stop) + ").", "Cuando llegue CERRAR SHORT, cancela las órdenes y cierra la posición."] }
      ];
    }
    avisos.push("Los objetivos 2R y 3R son referencia mía, no parte de la estrategia: la salida real es el stop móvil. Los nombres de los botones pueden variar un poco en tu pantalla.");
    return { titulo: (largo ? "Comprar (long) · " : "Vender (short) · ") + par, resumen: resumen, avisos: avisos, pasos: pasos };
  }

  root.Guia = { buildGuide: buildGuide };
  if (typeof module !== "undefined" && module.exports) module.exports = root.Guia;
})(typeof window !== "undefined" ? window : globalThis);
