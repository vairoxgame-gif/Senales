const assert = require("assert"), path = require("path"), fs = require("fs");
const P = require(path.join(__dirname, "..", "posiciones.js"));
const V = JSON.parse(fs.readFileSync(path.join(__dirname, "vectors_posiciones.json"), "utf8"));
V.forEach(function (v) {
  const r = P.evaluar(v.asset, v.pos, v.cfg);
  assert.strictEqual(r.accion, v.expected, v.name + ": esperaba " + v.expected + " y dio " + r.accion);
});
["VENDER", "TOMAR GANANCIA", "CERCA DEL STOP", "SUBIR STOP", "REVISAR", "AÑADIR", "MANTENER"].forEach(function (a) {
  assert(P.pasos(a, "NVDA").length >= 2, "faltan pasos de " + a);
});
const r = P.evaluar(V[0].asset, V[0].pos, V[0].cfg);
assert(Math.abs(r.pl - (-11)) < 1e-9);
console.log("posiciones OK (" + V.length + " casos)");
