#!/usr/bin/env python3
"""Calcula indicadores y señales y escribe data/signals.json.

Lógica = estrategia T-A Stop ATR 4 (ruptura del canal de 20 velas a favor de la
EMA 200, stop móvil 4xATR). Validada solo en BTC y ETH (4h). En el resto de los
activos es orientativa.

Uso:
  python3 scripts/update_signals.py                  # datos en vivo
  python3 scripts/update_signals.py --csv-dir DIR    # prueba offline (DIR/TICKER.csv)
  python3 scripts/update_signals.py --no-notify      # sin avisos push

Solo librería estándar. Avisos push a la propia app (opcional): PUSH_SUBSCRIPTION y VAPID_PRIVATE_KEY.
No ejecuta operaciones: solo informa.
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "signals.json"

# ticker -> (nombre, símbolo del proveedor, tipo, validada)
ASSETS = {
    "BTC": ("Bitcoin", "BTCUSDT", "cripto", True),
    "ETH": ("Ethereum", "ETHUSDT", "cripto", True),
    "SOL": ("Solana", "SOLUSDT", "cripto", False),
    "BNB": ("BNB", "BNBUSDT", "cripto", False),
    "XRP": ("XRP", "XRPUSDT", "cripto", False),
    "NVDA": ("NVIDIA", "NVDA", "accion", False),
    "AAPL": ("Apple", "AAPL", "accion", False),
    "MSFT": ("Microsoft", "MSFT", "accion", False),
    "TSLA": ("Tesla", "TSLA", "accion", False),
    "SPY": ("ETF S&P 500", "SPY", "accion", False),
    "QQQ": ("ETF Nasdaq-100", "QQQ", "accion", False),
}

ENTRY_LEN = 20
EMA_TREND = 200
ATR_LEN = 14
ATR_MULT = 4.0
MIN_BARS = EMA_TREND + 20


# ───────────────────────── indicadores ─────────────────────────
def sma_seed(values, n):
    return sum(values[:n]) / n


def ema(values, n):
    """EMA con semilla SMA (igual que ta.ema de Pine). None hasta tener n datos."""
    out = [None] * len(values)
    if len(values) < n:
        return out
    k = 2.0 / (n + 1)
    prev = sma_seed(values, n)
    out[n - 1] = prev
    for i in range(n, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def rma(values, n):
    """Media de Wilder con semilla SMA (ta.rma)."""
    out = [None] * len(values)
    if len(values) < n:
        return out
    prev = sma_seed(values, n)
    out[n - 1] = prev
    for i in range(n, len(values)):
        prev = (prev * (n - 1) + values[i]) / n
        out[i] = prev
    return out


def rsi(closes, n=14):
    gains = [0.0] + [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
    losses = [0.0] + [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]
    # el primer valor no es un cambio real: se descarta y se alinea
    g = rma(gains[1:], n)
    l = rma(losses[1:], n)
    out = [None]
    for ag, al in zip(g, l):
        if ag is None or al is None:
            out.append(None)
        elif al == 0:
            out.append(100.0)
        else:
            out.append(100 - 100 / (1 + ag / al))
    return out


def atr(highs, lows, closes, n=14):
    tr = [highs[0] - lows[0]]
    for i in range(1, len(closes)):
        tr.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    return rma(tr, n)


def macd(closes, fast=12, slow=26, sig=9):
    ef, es = ema(closes, fast), ema(closes, slow)
    line = [a - b if a is not None and b is not None else None for a, b in zip(ef, es)]
    first = next((i for i, v in enumerate(line) if v is not None), None)
    signal = [None] * len(closes)
    if first is not None:
        part = ema([v for v in line[first:]], sig)
        for j, v in enumerate(part):
            signal[first + j] = v
    return line, signal


def channel(highs, lows, i, n=ENTRY_LEN):
    """Máximo y mínimo de las n velas ANTERIORES a i (como ta.highest(...)[1])."""
    if i < n:
        return None, None
    return max(highs[i - n:i]), min(lows[i - n:i])


# ───────────────────────── simulación de la estrategia ─────────────────────────
def simulate(candles):
    """Recorre las velas y devuelve estado actual y último evento.

    Entradas al cierre de la vela que da la señal (aproximación: TradingView
    ejecuta en la apertura siguiente). Salida cuando el mínimo/máximo toca el
    stop móvil fijado en el cierre anterior.
    """
    t = [c["t"] for c in candles]
    o = [c["o"] for c in candles]
    h = [c["h"] for c in candles]
    lo = [c["l"] for c in candles]
    c_ = [c["c"] for c in candles]
    ema200 = ema(c_, EMA_TREND)
    atrs = atr(h, lo, c_, ATR_LEN)

    pos = 0  # 1 long, -1 short, 0 fuera
    trail = entry = entry_t = None
    last_event = None
    for i in range(len(c_)):
        if ema200[i] is None or atrs[i] is None or i < ENTRY_LEN:
            continue
        dist = atrs[i] * ATR_MULT
        if pos == 1 and lo[i] <= trail:
            last_event = {"tipo": "salida_long", "t": t[i], "precio": round(trail, 6)}
            pos = 0
        elif pos == -1 and h[i] >= trail:
            last_event = {"tipo": "salida_short", "t": t[i], "precio": round(trail, 6)}
            pos = 0
        elif pos == 1:
            trail = max(trail, c_[i] - dist)
        elif pos == -1:
            trail = min(trail, c_[i] + dist)
        if pos == 0 and last_event is not None and last_event["t"] == t[i]:
            continue  # no reentrar en la misma vela de la salida
        if pos == 0:
            up, dn = channel(h, lo, i)
            if c_[i] > up and c_[i] > ema200[i]:
                pos, entry, entry_t, trail = 1, c_[i], t[i], c_[i] - dist
                last_event = {"tipo": "entrada_long", "t": t[i], "precio": round(c_[i], 6)}
            elif c_[i] < dn and c_[i] < ema200[i]:
                pos, entry, entry_t, trail = -1, c_[i], t[i], c_[i] + dist
                last_event = {"tipo": "entrada_short", "t": t[i], "precio": round(c_[i], 6)}
    return {
        "posicion": {1: "long", -1: "short", 0: "fuera"}[pos],
        "entrada": entry if pos else None,
        "entrada_t": entry_t if pos else None,
        "stop_movil": trail if pos else None,
        "ultimo_evento": last_event,
    }


def analyze(ticker, candles, kind, validated):
    name = ASSETS[ticker][0]
    if len(candles) < MIN_BARS:
        raise ValueError(f"{ticker}: solo {len(candles)} velas; se necesitan {MIN_BARS}")
    h = [c["h"] for c in candles]
    lo = [c["l"] for c in candles]
    cl = [c["c"] for c in candles]
    e50, e200 = ema(cl, 50), ema(cl, EMA_TREND)
    r = rsi(cl, 14)
    a = atr(h, lo, cl, ATR_LEN)
    m, ms = macd(cl)
    up, dn = channel(h, lo, len(cl) - 1)
    sim = simulate(candles)
    last = candles[-1]
    price = last["c"]
    ev = sim["ultimo_evento"]
    nuevo = bool(ev and ev["t"] == last["t"])
    if price > e200[-1]:
        sesgo = "alcista"
    else:
        sesgo = "bajista"
    if sim["posicion"] == "long":
        estado = "comprar" if nuevo and ev["tipo"] == "entrada_long" else "mantener long"
    elif sim["posicion"] == "short":
        estado = "vender" if nuevo and ev["tipo"] == "entrada_short" else "mantener short"
    else:
        estado = "salir" if nuevo and ev and ev["tipo"].startswith("salida") else "esperar"
    prev_close = candles[-2]["c"]
    return {
        "ticker": ticker,
        "nombre": name,
        "tipo": kind,
        "validada": validated,
        "marco": "4h" if kind == "cripto" else "1d",
        "vela_cierre_t": last["t"],
        "precio": round(price, 6),
        "cambio_pct": round((price / prev_close - 1) * 100, 2),
        "sesgo": sesgo,
        "estado": estado,
        "nuevo": nuevo,
        "posicion": sim["posicion"],
        "entrada": sim["entrada"],
        "entrada_t": sim["entrada_t"],
        "stop_movil": round(sim["stop_movil"], 6) if sim["stop_movil"] else None,
        "ultimo_evento": ev,
        "indicadores": {
            "ema50": round(e50[-1], 6),
            "ema200": round(e200[-1], 6),
            "rsi14": round(r[-1], 2),
            "atr14": round(a[-1], 6),
            "macd": round(m[-1], 6) if m[-1] is not None else None,
            "macd_senal": round(ms[-1], 6) if ms[-1] is not None else None,
            "canal_sup": up,
            "canal_inf": dn,
            "stop_atr_dist": round(a[-1] * ATR_MULT, 6),
        },
        "gatillos": {
            "long": f"Cierre sobre {up:.6g} y sobre la EMA 200",
            "short": f"Cierre bajo {dn:.6g} y bajo la EMA 200",
        },
        "serie": [round(x["c"], 6) for x in candles[-60:]],
        "obsoleto": False,
    }


# ───────────────────────── datos ─────────────────────────
def http_json(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_crypto(symbol):
    now_ms = int(time.time() * 1000)
    last_err = None
    for host in ("https://data-api.binance.vision", "https://api.binance.com"):
        try:
            rows = http_json(f"{host}/api/v3/klines?symbol={symbol}&interval=4h&limit=1000")
            out = [
                {"t": int(r[0]) // 1000, "o": float(r[1]), "h": float(r[2]),
                 "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
                for r in rows if int(r[6]) < now_ms  # solo velas cerradas
            ]
            return out
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise RuntimeError(f"Binance: {last_err}")


def fetch_stock(symbol):
    from zoneinfo import ZoneInfo
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=2y&interval=1d"
    data = http_json(url)["chart"]["result"][0]
    q = data["indicators"]["quote"][0]
    out = []
    for i, ts in enumerate(data["timestamp"]):
        if None in (q["open"][i], q["high"][i], q["low"][i], q["close"][i]):
            continue
        out.append({"t": int(ts), "o": q["open"][i], "h": q["high"][i], "l": q["low"][i],
                    "c": q["close"][i], "v": q["volume"][i] or 0})
    ny = datetime.now(ZoneInfo("America/New_York"))
    if out:
        last_day = datetime.fromtimestamp(out[-1]["t"], ZoneInfo("America/New_York")).date()
        if last_day == ny.date() and (ny.hour, ny.minute) < (16, 15):
            out.pop()  # la vela de hoy aún no cerró
    return out


def read_csv(path):
    out = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            out.append({k: float(row[k]) if k != "t" else int(float(row[k]))
                        for k in ("t", "o", "h", "l", "c")} | {"v": float(row.get("v", 0) or 0)})
    return out


# ───────────────────────── avisos ─────────────────────────
TITULOS = {
    "entrada_long": "Señal de COMPRA (long)",
    "entrada_short": "Señal de VENTA (short): no comprar / salir si tienes",
    "salida_long": "Salida del long (stop móvil)",
    "salida_short": "Salida del short (stop móvil)",
}
SUBJECT = "https://vairoxgame-gif.github.io/Senales/"


def build_message(asset):
    ev = asset["ultimo_evento"]
    cuerpo = (
        f"{asset['ticker']} ({asset['marco']}) precio {asset['precio']:.6g}. "
        f"Stop móvil: {asset['stop_movil'] or 'n/a'}. "
        + ("Estrategia validada." if asset["validada"] else "Orientativa: no validada en este activo.")
        + " Informativo, no asesoría."
    )
    return {"title": f"{asset['ticker']}: {TITULOS.get(ev['tipo'], ev['tipo'])}", "body": cuerpo, "tag": asset["ticker"]}


def notify(asset, sender=None):
    """Aviso push a la propia app (Web Push). Requiere PUSH_SUBSCRIPTION y VAPID_PRIVATE_KEY."""
    sub_raw = os.environ.get("PUSH_SUBSCRIPTION", "").strip()
    priv = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if not sub_raw or not priv:
        return False
    try:
        sub = json.loads(sub_raw)
        if sender is None:
            import webpush  # noqa: PLC0415  (necesita `cryptography`)
            sender = webpush.send
        sender(sub, build_message(asset), priv, SUBJECT)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  aviso falló para {asset['ticker']}: {exc}", file=sys.stderr)
        return False


# ───────────────────────── principal ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv-dir")
    ap.add_argument("--no-notify", action="store_true")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    out_path = Path(args.out)
    previous = {}
    if out_path.exists():
        try:
            for a in json.loads(out_path.read_text())["activos"]:
                previous[a["ticker"]] = a
        except Exception:  # noqa: BLE001
            pass

    results, errors = [], []
    for ticker, (_, sym, kind, validated) in ASSETS.items():
        try:
            if args.csv_dir:
                candles = read_csv(Path(args.csv_dir) / f"{ticker}.csv")
            else:
                candles = fetch_crypto(sym) if kind == "cripto" else fetch_stock(sym)
            results.append(analyze(ticker, candles, kind, validated))
            print(f"ok  {ticker}: {results[-1]['estado']}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{ticker}: {exc}")
            print(f"ERR {ticker}: {exc}", file=sys.stderr)
            if ticker in previous:
                stale = dict(previous[ticker])
                stale["obsoleto"] = True
                results.append(stale)

    if not results:
        print("Sin datos: no se escribe nada.", file=sys.stderr)
        return 1

    if not args.no_notify:
        for a in results:
            ev = a.get("ultimo_evento")
            if a.get("nuevo") and not a.get("obsoleto") and ev:
                prev_ev = (previous.get(a["ticker"]) or {}).get("ultimo_evento")
                if not prev_ev or prev_ev["t"] != ev["t"] or prev_ev["tipo"] != ev["tipo"]:
                    notify(a)

    payload = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "errores": errors,
        "aviso": "Información, no asesoría financiera personalizada. La app no ejecuta operaciones.",
        "activos": results,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"Escrito {out_path} ({len(results)} activos, {len(errors)} errores)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
