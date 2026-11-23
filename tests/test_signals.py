import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import update_signals as u  # noqa: E402


def bars(closes, spread=1.0):
    out = []
    for i, c in enumerate(closes):
        out.append({"t": 1_700_000_000 + i * 14400, "o": c, "h": c + spread, "l": c - spread, "c": c, "v": 1})
    return out


class Indicators(unittest.TestCase):
    def test_ema_seed_and_recursion(self):
        e = u.ema([1, 2, 3, 4, 5], 3)
        self.assertEqual(e[:2], [None, None])
        self.assertAlmostEqual(e[2], 2.0)          # SMA(1,2,3)
        self.assertAlmostEqual(e[3], 3.0)          # 4*0.5 + 2*0.5
        self.assertAlmostEqual(e[4], 4.0)

    def test_rsi_extremes(self):
        up = u.rsi([float(i) for i in range(1, 40)], 14)
        self.assertAlmostEqual(up[-1], 100.0)
        down = u.rsi([float(i) for i in range(40, 1, -1)], 14)
        self.assertAlmostEqual(down[-1], 0.0, places=6)

    def test_atr_constant_range(self):
        c = [100.0] * 40
        a = u.atr([101.0] * 40, [99.0] * 40, c, 14)
        self.assertAlmostEqual(a[-1], 2.0)

    def test_channel_excludes_current_bar(self):
        h = [1, 2, 3, 4, 5, 100]
        lo = [0, 0, 0, 0, 0, 0]
        up, dn = u.channel(h, lo, 5, n=5)
        self.assertEqual(up, 5)


class Strategy(unittest.TestCase):
    def test_uptrend_breakout_enters_long_then_stops_out(self):
        base = [100.0] * 230
        up = [100 + 2 * i for i in range(1, 30)]          # tendencia fuerte alcista
        crash = [up[-1] - 10 * i for i in range(1, 4)]    # caída que toca el stop, sin cruzar bajo el canal
        data = bars(base + up + crash, spread=1.0)
        res = u.simulate(data)
        self.assertEqual(res["posicion"], "fuera")
        self.assertEqual(res["ultimo_evento"]["tipo"], "salida_long")

    def test_downtrend_breakdown_enters_short(self):
        base = [500.0] * 230
        down = [500 - 3 * i for i in range(1, 30)]
        res = u.simulate(bars(base + down))
        self.assertEqual(res["posicion"], "short")
        self.assertLess(res["entrada"], 500)
        self.assertGreater(res["stop_movil"], 500 - 3 * 29)  # el stop de un short queda sobre el precio actual

    def test_flat_market_no_signal(self):
        closes = [100 + math.sin(i / 3) for i in range(260)]
        res = u.simulate(bars(closes, spread=0.5))
        self.assertEqual(res["posicion"], "fuera")

    def test_analyze_requires_history(self):
        with self.assertRaises(ValueError):
            u.analyze("BTC", bars([1.0] * 50), "cripto", True)

    def test_analyze_output_fields(self):
        base = [100.0] * 230
        up = [100 + 2 * i for i in range(1, 15)]
        a = u.analyze("BTC", bars(base + up), "cripto", True)
        self.assertEqual(a["posicion"], "long")
        self.assertIn(a["estado"], ("comprar", "mantener long"))
        self.assertLess(a["stop_movil"], a["precio"])
        self.assertEqual(a["marco"], "4h")


if __name__ == "__main__":
    unittest.main()
