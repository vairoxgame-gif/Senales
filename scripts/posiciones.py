"""Posiciones compradas (long): decide MANTENER / VENDER / TOMAR GANANCIA / ... y avisa.

Espejo exacto de posiciones.js (mismas reglas; ambos se prueban con tests/vectors_posiciones.json).
Las posiciones llegan por la variable de entorno POSICIONES (secreto privado de GitHub):
    {"capital": 1000, "riesgo": 1, "posiciones": [{"ticker","cantidad","compra","stop","obj1","obj2"}]}
Nunca se escriben en el repositorio.
"""
import json
import os
import sys


def evaluar(a, pos, cfg):
    ind = a.get("indicadores") or {}
    p, atr, ema50, ema200, rsi = a["precio"], ind["atr14"], ind["ema50"], ind["ema200"], ind["rsi14"]
    compra = float(pos["compra"])
    stop = float(pos["stop"]) if (pos.get("stop") or 0) > 0 else compra - 2 * atr
    r0 = compra - stop if compra - stop > 0 else 2 * atr
    obj1 = float(pos["obj1"]) if (pos.get("obj1") or 0) > 0 else compra + 2 * r0
    obj2 = float(pos["obj2"]) if (pos.get("obj2") or 0) > 0 else compra + 3 * r0
    pl = (p - compra) / compra * 100

    def out(accion, motivo):
        return {"accion": accion, "motivo": motivo, "stop": stop, "obj1": obj1, "obj2": obj2, "pl": pl, "r0": r0}

    if p <= stop:
        return out("VENDER", "El precio tocó tu stop. Sal de la posición para limitar la pérdida o proteger lo ganado.")
    if p >= obj2:
        return out("VENDER", "Alcanzó tu objetivo 2. Cierra la posición y asegura la ganancia.")
    if p >= obj1:
        return out("TOMAR GANANCIA", "Alcanzó tu objetivo 1. Vende cerca de la mitad y sube el stop a tu precio de compra.")
    if p - stop <= atr:
        return out("CERCA DEL STOP", "Tu stop está a menos de 1 ATR (un día normal de movimiento). Puede saltar con ruido: revisa un stop más amplio o reduce el tamaño.")
    if p >= compra + r0 and stop < compra:
        return out("SUBIR STOP", "Ganas al menos 1R. Sube el stop a tu precio de compra para no perder dinero en esta operación.")
    if compra >= ema50 and p < ema50:
        return out("REVISAR", "Compraste sobre la EMA 50 y el precio la perdió: la tendencia se debilitó. Evalúa reducir.")
    capital = float((cfg or {}).get("capital") or 0)
    riesgo = float((cfg or {}).get("riesgo") or 0)
    budget = capital * riesgo / 100 if capital > 0 else 0
    open_risk = float(pos["cantidad"]) * max(p - stop, 0)
    if p > ema200 and ema50 > ema200 and abs(p - ema50) <= atr and 40 <= rsi <= 60 and budget > 0 and open_risk < budget:
        return out("AÑADIR", "Tendencia alcista, el precio volvió cerca de la EMA 50 y tu riesgo abierto es menor al presupuesto. Puedes sumar un escalón pequeño.")
    return out("MANTENER", "El precio sigue sobre tu stop y no hay condiciones de acción. Mantén y revisa en el próximo cierre.")


def cargar(raw):
    """Lee el secreto POSICIONES. Devuelve (cfg, lista) o (None, [])."""
    raw = (raw or "").strip()
    if not raw:
        return None, []
    try:
        data = json.loads(raw)
        lista = [p for p in data.get("posiciones", []) if p.get("ticker") and float(p.get("compra", 0)) > 0 and float(p.get("cantidad", 0)) > 0]
        return {"capital": data.get("capital"), "riesgo": data.get("riesgo")}, lista
    except Exception as exc:  # noqa: BLE001  (no imprimir el contenido: es privado)
        print(f"POSICIONES no es un JSON válido ({type(exc).__name__}).", file=sys.stderr)
        return None, []


def _es(x, dec=2):
    return f"{x:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def mensaje(a, pos, ev):
    tk = a["ticker"]
    pre = _es(a["precio"], 2 if abs(a["precio"]) >= 1 else 4)
    return {
        "title": f"{tk}: {ev['accion']}",
        "body": (f"{ev['motivo']}\nPrecio ${pre} · tu compra ${_es(pos['compra'])} ({ev['pl']:+.1f}%) · stop ${_es(ev['stop'])}\n"
                 "Toca para ver los pasos. Informativo, no asesoría."),
        "tag": f"pos-{tk}", "ticker": tk, "vista": "pos",
    }


def notificar(previous, results, cfg, posiciones, sender):
    """Avisa solo cuando la acción recomendada CAMBIA entre la corrida anterior y esta.
    No necesita guardar estado: compara la evaluación con los datos previos y con los nuevos."""
    enviados = 0
    por_ticker = {a["ticker"]: a for a in results}
    for pos in posiciones:
        a = por_ticker.get(pos["ticker"])
        prev = previous.get(pos["ticker"])
        if not a or a.get("obsoleto") or not prev:
            continue
        try:
            nuevo = evaluar(a, pos, cfg)
            antes = evaluar(prev, pos, cfg)
        except Exception as exc:  # noqa: BLE001
            print(f"  posición {pos.get('ticker')}: no se pudo evaluar ({type(exc).__name__})", file=sys.stderr)
            continue
        if nuevo["accion"] != "MANTENER" and nuevo["accion"] != antes["accion"]:
            try:
                sender(mensaje(a, pos, nuevo))
                enviados += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  aviso de posición falló para {pos['ticker']}: {exc}", file=sys.stderr)
    return enviados
