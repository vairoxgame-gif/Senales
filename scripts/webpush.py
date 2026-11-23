"""Web Push mínimo (RFC 8030 + RFC 8291 aes128gcm + VAPID RFC 8292).

Solo depende de `cryptography`. Envía un aviso al navegador del usuario sin ningún
servicio de notificaciones de terceros: el aviso viaja por el servicio push del propio
navegador (Google/Mozilla/Apple), que ya viene integrado en el sistema.
"""
import base64
import json
import os
import struct
import time
import urllib.request
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_dec(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(payload: bytes, client_pub_b64: str, auth_b64: str, *, salt=None, server_key=None) -> bytes:
    """Cuerpo cifrado aes128gcm (RFC 8291) para una suscripción push."""
    ua_pub = b64u_dec(client_pub_b64)
    auth = b64u_dec(auth_b64)
    salt = salt or os.urandom(16)
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_pub = server_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    client_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub)
    secret = server_key.exchange(ec.ECDH(), client_key)
    ikm = _hkdf(auth, secret, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    record = payload + b"\x02"  # delimitador del último registro
    ciphertext = AESGCM(cek).encrypt(nonce, record, None)
    header = salt + struct.pack(">IB", 4096, len(as_pub)) + as_pub
    return header + ciphertext


def decrypt(body: bytes, client_priv: ec.EllipticCurvePrivateKey, auth_b64: str) -> bytes:
    """Inverso de encrypt (lo usan las pruebas para verificar el formato)."""
    salt = body[:16]
    idlen = body[20]
    as_pub = body[21:21 + idlen]
    ct = body[21 + idlen:]
    ua_pub = client_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    secret = client_priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
    ikm = _hkdf(b64u_dec(auth_b64), secret, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ct, None)
    plain = plain.rstrip(b"\x00")
    if not plain.endswith(b"\x02"):
        raise ValueError("registro sin delimitador")
    return plain[:-1]


def vapid_headers(endpoint: str, private_b64: str, subject: str, *, now=None) -> dict:
    """Cabecera Authorization (VAPID, ES256) para el origen del endpoint."""
    u = urlparse(endpoint)
    aud = f"{u.scheme}://{u.netloc}"
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    exp = int(now or time.time()) + 12 * 3600
    claims = b64u(json.dumps({"aud": aud, "exp": exp, "sub": subject}, separators=(",", ":")).encode())
    signing = f"{header}.{claims}".encode()
    key = ec.derive_private_key(int.from_bytes(b64u_dec(private_b64), "big"), ec.SECP256R1())
    r, s = decode_dss_signature(key.sign(signing, ec.ECDSA(hashes.SHA256())))
    sig = b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {"Authorization": f"vapid t={header}.{claims}.{sig}, k={b64u(pub)}"}


def send(subscription: dict, message: dict, private_b64: str, subject: str, *, ttl=3600, opener=None):
    """Envía `message` (dict) a la suscripción. Devuelve el código HTTP.
    Lanza urllib.error.HTTPError si el servicio push rechaza (404/410 = suscripción caducada)."""
    keys = subscription["keys"]
    body = encrypt(json.dumps(message, ensure_ascii=False).encode("utf-8"), keys["p256dh"], keys["auth"])
    headers = {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(ttl),
        "Urgency": "high",
        **vapid_headers(subscription["endpoint"], private_b64, subject),
    }
    req = urllib.request.Request(subscription["endpoint"], data=body, headers=headers, method="POST")
    with (opener or urllib.request.urlopen)(req, timeout=20) as r:
        return r.status
