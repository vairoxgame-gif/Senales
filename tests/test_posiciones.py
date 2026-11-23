import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import posiciones as pz  # noqa: E402

VECTORS = json.loads((Path(__file__).parent / "vectors_posiciones.json").read_text(encoding="utf-8"))


def asset(p, tk="NVDA", atr=10, ema50=100, ema200=80, rsi=50):
    return {"ticker": tk, "precio": p, "indicadores": {"ema50": ema50, "ema200": ema200, "rsi14": rsi, "atr14": atr}}


class Motor(unittest.TestCase):
    def test_vectores_compartidos_con_js(self):
        for v in VECTORS:
            with self.subTest(v["name"]):
                self.assertEqual(pz.evaluar(v["asset"], v["pos"], v["cfg"])["accion"], v["expected"])

    def test_pl(self):
        self.assertAlmostEqual(pz.evaluar(asset(89), {"cantidad": 1, "compra": 100, "stop": 90}, None)["pl"], -11.0)


class Avisos(unittest.TestCase):
    POS = [{"ticker": "NVDA", "cantidad": 1, "compra": 100, "stop": 90}]
    CFG = {"capital": 1000, "riesgo": 1}

    def run_notify(self, prev_price, new_price, obsoleto=False, with_prev=True):
        sent = []
        new = asset(new_price)
        if obsoleto:
            new["obsoleto"] = True
        prev = {"NVDA": asset(prev_price)} if with_prev else {}
        n = pz.notificar(prev, [new], self.CFG, self.POS, sent.append)
        return n, sent

    def test_avisa_al_cruzar_el_stop_una_sola_vez(self):
        n, sent = self.run_notify(95, 89)
        self.assertEqual(n, 1)
        self.assertEqual(sent[0]["title"], "NVDA: VENDER")
        self.assertEqual(sent[0]["vista"], "pos")
        self.assertEqual(sent[0]["ticker"], "NVDA")
        n2, _ = self.run_notify(89, 88)  # ya estaba en VENDER: no repite
        self.assertEqual(n2, 0)

    def test_no_avisa_si_sigue_en_mantener(self):
        n, _ = self.run_notify(106, 107)
        self.assertEqual(n, 0)

    def test_sin_datos_previos_u_obsoleto_no_avisa(self):
        self.assertEqual(self.run_notify(95, 89, with_prev=False)[0], 0)
        self.assertEqual(self.run_notify(95, 89, obsoleto=True)[0], 0)

    def test_ticker_sin_datos_se_ignora(self):
        sent = []
        n = pz.notificar({}, [asset(89, tk="AAPL")], self.CFG, self.POS, sent.append)
        self.assertEqual(n, 0)

    def test_mensaje_sin_datos_sensibles_extra(self):
        n, sent = self.run_notify(95, 89)
        self.assertNotIn("cantidad", sent[0]["body"].lower())

    def test_cargar_secreto(self):
        cfg, lista = pz.cargar(json.dumps({"capital": 500, "riesgo": 2, "posiciones": [
            {"ticker": "NVDA", "cantidad": 2, "compra": 165}, {"ticker": "X", "cantidad": 0, "compra": 1}]}))
        self.assertEqual(cfg["capital"], 500)
        self.assertEqual(len(lista), 1)
        self.assertEqual(pz.cargar("")[1], [])
        self.assertEqual(pz.cargar("no es json")[1], [])


if __name__ == "__main__":
    unittest.main()
