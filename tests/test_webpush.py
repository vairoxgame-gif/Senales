import base64
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import update_signals as u  # noqa: E402

try:
    import webpush as w  # noqa: E402
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    HAVE = True
except ImportError:  # pragma: no cover
    HAVE = False


def client():
    k = ec.generate_private_key(ec.SECP256R1())
    pub = k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return k, w.b64u(pub), w.b64u(os.urandom(16))


@unittest.skipUnless(HAVE, "falta cryptography")
class WebPush(unittest.TestCase):
    def test_encrypt_roundtrip(self):
        k, pub, auth = client()
        msg = json.dumps({"title": "BTC: Señal de COMPRA", "body": "ñandú €"}, ensure_ascii=False).encode()
        body = w.encrypt(msg, pub, auth)
        self.assertEqual(w.decrypt(body, k, auth), msg)
        self.assertEqual(body[16:20], (4096).to_bytes(4, "big"))
        self.assertEqual(body[20], 65)

    def test_rfc8291_vector(self):
        # Vector de prueba del RFC 8291, sección 5.
        auth = "BTBZMqHH6r4Tts7J_aSIgg"
        ua_pub = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
        as_priv = w.b64u_dec("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
        salt = w.b64u_dec("DGv6ra1nlYgDCS1FRnbzlw")
        server_key = ec.derive_private_key(int.from_bytes(as_priv, "big"), ec.SECP256R1())
        body = w.encrypt(b"When I grow up, I want to be a watermelon", ua_pub, auth, salt=salt, server_key=server_key)
        expected = ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
                    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
                    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
        self.assertEqual(w.b64u(body), expected)

    def test_vapid_signature_valid(self):
        k = ec.generate_private_key(ec.SECP256R1())
        priv = w.b64u(k.private_numbers().private_value.to_bytes(32, "big"))
        h = w.vapid_headers("https://fcm.googleapis.com/fcm/send/abc", priv, "https://x.example/", now=1_000_000)
        auth = h["Authorization"]
        self.assertTrue(auth.startswith("vapid t="))
        jwt, key = auth[len("vapid t="):].split(", k=")
        head, claims, sig = jwt.split(".")
        c = json.loads(w.b64u_dec(claims))
        self.assertEqual(c["aud"], "https://fcm.googleapis.com")
        self.assertEqual(c["sub"], "https://x.example/")
        self.assertEqual(c["exp"], 1_000_000 + 12 * 3600)
        raw = w.b64u_dec(sig)
        self.assertEqual(len(raw), 64)
        pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), w.b64u_dec(key))
        pub.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                   f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))

    def test_send_builds_request(self):
        k, pub, auth = client()
        sk = ec.generate_private_key(ec.SECP256R1())
        priv = w.b64u(sk.private_numbers().private_value.to_bytes(32, "big"))
        seen = {}

        class R:
            status = 201
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def opener(req, timeout=0):
            seen["req"] = req
            return R()

        sub = {"endpoint": "https://push.example/abc", "keys": {"p256dh": pub, "auth": auth}}
        code = w.send(sub, {"title": "t", "body": "b"}, priv, "https://x.example/", opener=opener)
        self.assertEqual(code, 201)
        r = seen["req"]
        self.assertEqual(r.get_header("Content-encoding"), "aes128gcm")
        self.assertEqual(json.loads(w.decrypt(r.data, k, auth)), {"title": "t", "body": "b"})


class Notify(unittest.TestCase):
    ASSET = {"ticker": "BTC", "tipo": "cripto", "marco": "4h", "precio": 100.0, "entrada": 100.0, "stop_movil": 90.0,
             "validada": True, "indicadores": {"atr14": 2.5}, "ultimo_evento": {"tipo": "entrada_long", "t": 1}}

    def test_no_config_does_nothing(self):
        with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTION": "", "VAPID_PRIVATE_KEY": ""}):
            self.assertFalse(u.notify(self.ASSET, sender=lambda *a: self.fail("no debe enviar")))

    def test_sends_message(self):
        got = {}
        env = {"PUSH_SUBSCRIPTION": json.dumps({"endpoint": "https://e/x", "keys": {}}), "VAPID_PRIVATE_KEY": "k"}
        with mock.patch.dict(os.environ, env):
            ok = u.notify(self.ASSET, sender=lambda sub, msg, priv, subj: got.update(msg=msg, priv=priv))
        self.assertTrue(ok)
        self.assertIn("LONG", got["msg"]["title"])
        self.assertIn("Informativo", got["msg"]["body"])

    def test_message_levels_long_and_short(self):
        m = u.build_message(self.ASSET)  # entrada 100, stop 90 -> r=10
        self.assertIn("STOP-LOSS $90,00", m["body"])
        self.assertIn("$120,00 (2R)", m["body"])
        self.assertIn("$130,00 (3R)", m["body"])
        self.assertIn("1,0%", m["body"].split("Trailing")[0] + "1,0%")  # formato es-AR presente
        self.assertIn("Trailing stop de Binance: ~10,0%", m["body"])
        self.assertIn("1 BTC ($100,00)", m["body"])  # 10 USDT de riesgo / r=10 -> 1 unidad
        sh = dict(self.ASSET, stop_movil=110.0, ultimo_evento={"tipo": "entrada_short", "t": 1})
        ms = u.build_message(sh)
        self.assertIn("SHORT", ms["title"])
        self.assertIn("STOP-LOSS $110,00", ms["body"])
        self.assertIn("$80,00 (2R)", ms["body"])
        self.assertIn("Lemon", ms["body"])

    def test_message_stock_has_no_binance_trailing(self):
        a = dict(self.ASSET, ticker="NVDA", tipo="accion", marco="1d", validada=False)
        m = u.build_message(a)
        self.assertNotIn("Binance", m["body"])
        self.assertIn("NO validada", m["body"])

    def test_payload_carries_ticker_for_deep_link(self):
        self.assertEqual(u.build_message(self.ASSET)["ticker"], "BTC")
        self.assertEqual(u.build_message(dict(self.ASSET, ultimo_evento={"tipo": "salida_long", "t": 2}))["ticker"], "BTC")

    def test_exit_message(self):
        m = u.build_message(dict(self.ASSET, ultimo_evento={"tipo": "salida_long", "t": 2}))
        self.assertIn("CERRAR LONG", m["title"])

    def test_sender_error_is_swallowed(self):
        def boom(*a): raise RuntimeError("410")
        env = {"PUSH_SUBSCRIPTION": json.dumps({"endpoint": "e", "keys": {}}), "VAPID_PRIVATE_KEY": "k"}
        with mock.patch.dict(os.environ, env):
            self.assertFalse(u.notify(self.ASSET, sender=boom))

    def test_send_test_ok_and_missing_secrets(self):
        env = {"PUSH_SUBSCRIPTION": json.dumps({"endpoint": "e", "keys": {}}), "VAPID_PRIVATE_KEY": "k"}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(u.send_test(sender=lambda *a: 201), 0)
        with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTION": "", "VAPID_PRIVATE_KEY": "k"}):
            self.assertEqual(u.send_test(sender=lambda *a: 201), 1)


if __name__ == "__main__":
    unittest.main()
