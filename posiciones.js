/* Motor de decisión para posiciones compradas (long): MANTENER / VENDER / TOMAR GANANCIA / ...
   Funciones puras. Debe dar el mismo resultado que scripts/posiciones.py (se comprueba con
   tests/vectors_posiciones.json en ambos lados). */
(function (root) {
  "use strict";

  function evaluar(a, pos, cfg) {
    var ind = a.indicadores || {};
    var p = a.precio, atr = ind.atr14, ema50 = ind.ema50, ema200 = ind.ema200, rsi = ind.rsi14;
    var compra = pos.compra;
    var stop = pos.stop > 0 ? pos.stop : compra - 2 * atr;
    var r0 = compra - stop > 0 ? compra - stop : 2 * atr;
    var obj1 = pos.obj1 > 0 ? pos.obj1 : compra + 2 * r0;
    var obj2 = pos.obj2 > 0 ? pos.obj2 : compra + 3 * r0;
    var pl = (p - compra) / compra * 100;
    function out(accion, motivo) { return { accion: accion, motivo: motivo, stop: stop, obj1: obj1, obj2: obj2, pl: pl, r0: r0 }; }

    if (p <= stop) return out("VENDER", "El precio tocó tu stop. Sal de la posición para limitar la pérdida o proteger lo ganado.");
    if (p >= obj2) return out("VENDER", "Alcanzó tu objetivo 2. Cierra la posición y asegura la ganancia.");
    if (p >= obj1) return out("TOMAR GANANCIA", "Alcanzó tu objetivo 1. Vende cerca de la mitad y sube el stop a tu precio de compra.");
    if (p - stop <= atr) return out("CERCA DEL STOP", "Tu stop está a menos de 1 ATR (un día normal de movimiento). Puede saltar con ruido: revisa un stop más amplio o reduce el tamaño.");
    if (p >= compra + r0 && stop < compra) return out("SUBIR STOP", "Ganas al menos 1R. Sube el stop a tu precio de compra para no perder dinero en esta operación.");
    if (compra >= ema50 && p < ema50) return out("REVISAR", "Compraste sobre la EMA 50 y el precio la perdió: la tendencia se debilitó. Evalúa reducir.");
    var budget = cfg && cfg.capital > 0 ? cfg.capital * cfg.riesgo / 100 : 0;
    var openRisk = pos.cantidad * Math.max(p - stop, 0);
    if (p > ema200 && ema50 > ema200 && Math.abs(p - ema50) <= atr && rsi >= 40 && rsi <= 60 && budget > 0 && openRisk < budget) {
      return out("AÑADIR", "Tendencia alcista, el precio volvió cerca de la EMA 50 y tu riesgo abierto es menor al presupuesto. Puedes sumar un escalón pequeño.");
    }
    return out("MANTENER", "El precio sigue sobre tu stop y no hay condiciones de acción. Mantén y revisa en el próximo cierre.");
  }

  function pasos(accion, tk) {
    var m = {
      "VENDER": ["Cancela órdenes o alertas pendientes de " + tk + ".", "Vende toda la posición (orden de mercado o límite cerca del precio).", "Anota precio de salida y resultado en tu registro."],
      "TOMAR GANANCIA": ["Vende aproximadamente la mitad de tus " + tk + ".", "Sube tu stop al precio de compra para el resto.", "Deja correr el resto hasta el objetivo 2 o el stop."],
      "CERCA DEL STOP": ["No hagas nada apresurado: decide ahora si el stop es el correcto.", "Opciones: ampliar el stop (y bajar el tamaño) o aceptar que puede saltar.", "Si saltas el stop, vende sin dudar."],
      "SUBIR STOP": ["Cambia tu stop (o alerta) al precio de compra.", "Así, si el precio vuelve, sales sin pérdida."],
      "REVISAR": ["Mira el gráfico diario: ¿cerró bajo la EMA 50 con volumen?", "Si se confirma, considera vender una parte.", "Respeta tu stop de todos modos."],
      "AÑADIR": ["Compra un escalón pequeño (no más del 25–50% de tu posición actual).", "Recalcula tu stop promedio y tu riesgo total.", "Anota la nueva compra en la app."],
      "MANTENER": ["No hagas nada.", "Revisa en el próximo aviso o cierre diario."]
    };
    return m[accion] || m["MANTENER"];
  }

  root.Posiciones = { evaluar: evaluar, pasos: pasos };
  if (typeof module !== "undefined" && module.exports) module.exports = root.Posiciones;
})(typeof window !== "undefined" ? window : globalThis);
