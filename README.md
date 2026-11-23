# Señales de Mercado (PWA)

App instalable para el teléfono con señales de tendencia en cripto (4h) y acciones (diario).
**Informativa: no ejecuta operaciones ni es asesoría financiera personalizada.**

## Qué hay
- `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`: la app (sin dependencias).
- `scripts/update_signals.py`: baja velas, calcula EMA 50/200, RSI, ATR, MACD, canal de 20 velas y la
  señal de la estrategia T-A Stop ATR 4 (ruptura del canal a favor de la EMA 200, stop móvil 4×ATR).
  Solo usa la librería estándar de Python.
- `data/signals.json`: resultado que lee la app. `data/demo.json`: datos **sintéticos** para ver la interfaz
  (`?demo=1`).
- `.github/workflows/actualizar.yml`: corre el script a las 00, 04, 08, 12, 16 y 20 UTC (+7 min).
- `tests/`: pruebas de indicadores y de la lógica de la estrategia (`python3 -I -m unittest discover -s tests`).

## Activos
Cripto (velas 4h, Binance): BTC, ETH, SOL, BNB, XRP. Acciones/ETF (velas diarias, Yahoo Finance):
NVDA, AAPL, MSFT, TSLA, SPY, QQQ. Cambia la lista en `ASSETS` dentro del script.
**Solo BTC y ETH están validados con backtest.** El resto es orientativo.

## Publicarla (gratis, GitHub Pages)
1. Crea un repositorio en GitHub y sube el contenido de esta carpeta a la raíz.
2. Settings → Pages → Source: "Deploy from a branch", rama `main`, carpeta `/ (root)`.
3. Settings → Actions → General → Workflow permissions: "Read and write permissions".
4. Actions → "Actualizar señales" → Run workflow (primera ejecución manual) y revisa que
   `data/signals.json` se llene.
5. Abre la URL de Pages en el teléfono: Android/Chrome → menú → "Instalar app"; iPhone/Safari →
   Compartir → "Añadir a pantalla de inicio".

## Avisos dentro de la propia app (Web Push)
Sin apps de terceros: el aviso viaja por el servicio push de tu navegador (Chrome/Safari).
1. Abre la app instalada → ⚙ Ajustes → **Activar avisos en este dispositivo** → acepta el permiso.
2. Toca **Copiar código** (es un JSON con la dirección de tu navegador).
3. En el repo: Settings → Secrets and variables → Actions → New repository secret:
   - `PUSH_SUBSCRIPTION` = el código copiado.
   - `VAPID_PRIVATE_KEY` = la clave privada que te entregó Claude (par de la pública incluida en `app.js`).
4. Ejecuta el workflow una vez. Desde ahí, cada señal nueva en una vela cerrada dispara un aviso.
iPhone: requiere iOS 16.4 o superior y abrir la app desde el ícono de inicio.
Si cambias de teléfono o reinstalas la app, repite los pasos 1–3 (la suscripción cambia).

## Mis posiciones (mantener / vender / tomar ganancia / añadir)
1. En la app, pestaña **Mis posiciones** → **Agregar posición**: activo, cantidad, precio de compra en USD y stop.
2. La app evalúa cada posición con el último cierre (en cripto, con el precio en vivo) y recomienda:
   VENDER, TOMAR GANANCIA, CERCA DEL STOP, SUBIR STOP, REVISAR, AÑADIR o MANTENER.
3. Las posiciones se guardan solo en tu teléfono. Para avisos con la app cerrada: **Avisos con la app cerrada** →
   Copiar → secreto privado `POSICIONES` en GitHub. El servidor avisa cuando la recomendación cambia.
4. Límites: solo compras (long); acciones evaluadas con el cierre diario, sin vigilar el stop durante el día.

## Límites conocidos
- Las entradas se simulan al cierre de la vela; en TradingView se ejecutan en la apertura siguiente.
- Las velas de 4h de Binance pueden diferir de las agregadas de TradingView con las que se hizo el backtest.
- GitHub Actions puede retrasar unos minutos el cron. Si Binance bloquea las IP de GitHub, habrá que
  cambiar de proveedor de datos o usar otro servidor.
- Un backtest no garantiza resultados futuros. Usa stop y riesgo de 1–2% del capital; apalancamiento ≤3×.
