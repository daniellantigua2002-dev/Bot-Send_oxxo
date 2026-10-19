# Bot de Telegram – OXXO de Ecart Pay

Bot de Telegram que, según el monto que escribe el usuario, entra al link de pago de Ecart Pay, genera un pago en efectivo OXXO nuevo y responde con la imagen del voucher. Solo funciona dentro del grupo VIP autorizado.

```
Usuario:  490
Bot:      ⏳ Ana, tu OXXO de $490 se está cargando…
          ▰▰▰▰▰▱▱▱▱▱  48%
          Generando tu referencia OXXO…
          (el porcentaje sube cada 2 s mientras se genera)
          (este mensaje se borra al llegar la imagen)
Bot:      [imagen del voucher OXXO, como respuesta al mensaje de Ana]
          ✅ Ana, aquí está tu OXXO de $490
          (y reacciona 👍 al mensaje "490" de Ana)
```

- Acepta montos como `490`, `$490`, `1,089` o `1089.00`.
- Cada petición crea una orden nueva en Ecart Pay: nunca se reenvía un OXXO anterior.
- Atiende **una petición a la vez, en orden de llegada**. Mientras espera, el mensaje dice cuántas personas van antes.
- Si el monto no está en `data/paymentLinks.json` responde con la tabla de montos disponibles, sin abrir el navegador.
- **Borra automáticamente** todo lo que no sea un monto: texto con letras, fotos, videos, stickers, archivos, audios, etc. También los de los administradores (un error de teclado no debe quedarse en el grupo). Solo respeta los avisos de Telegram ("X se unió al grupo").
- **Cada domingo limpia las capturas de error**: borra todo lo que haya en `debug/` (así ninguna dura más de una semana) y, si borró algo, avisa en el grupo ("🧹 Limpieza semanal: se eliminaron N capturas de OXXO."). La limpieza entra a la misma fila que los OXXO, de uno en uno, por eso nunca se cruza con un OXXO en proceso y los que lleguen mientras limpia esperan su turno.
- En chats privados responde "Acceso denegado". En otros grupos no responde.

## Requisitos

- [Node.js](https://nodejs.org/) 22.18 o superior (recomendado: 24 LTS)
- Un bot creado con [@BotFather](https://t.me/BotFather)
- Chromium de Playwright (se instala con el segundo comando de abajo)

## Instalación

```bash
npm install
npx playwright install chromium
```

Crea tus archivos de configuración a partir de los ejemplos:

```bash
cp .env.example .env
cp data/paymentLinks.example.json data/paymentLinks.json
```

Llena `.env` con tus datos:

| Variable | Descripción |
|---|---|
| `BOT_TOKEN` | Token del bot que te da @BotFather |
| `ALLOWED_GROUP_ID` | ID del grupo VIP (los supergrupos empiezan con `-100`) |
| `PAYMENT_LINKS` | *(opcional en local)* Los links como JSON en una sola línea. Si está puesta, se usa en lugar del archivo. En el servidor es la forma de pasar los links sin subirlos a git. |
| `LOG_UPDATES` | `true` para ver en consola el Chat ID de cada mensaje |
| `HEADLESS` | `false` para ver la ventana de Chromium mientras genera el OXXO (solo para depurar). Por defecto `true` |

Y en `data/paymentLinks.json` pon tus montos y links:

```json
{
  "490": "https://pay.ecart.com/payment_link/..."
}
```

De dónde salen los links, en orden de prioridad:

1. La variable de entorno `PAYMENT_LINKS` (el mismo JSON, pero en una sola línea). Es lo que se usa en el servidor.
2. Si no está esa variable, el archivo `data/paymentLinks.json`. Es lo cómodo en local.

> `.env` y `data/paymentLinks.json` **no se suben a GitHub** (están en `.gitignore`).

## Uso

| Comando | Para qué sirve |
|---|---|
| `npm run dev` | Desarrollo: ejecuta el TypeScript directo y se reinicia al guardar |
| `npm run typecheck` | Revisa errores de tipos sin compilar |
| `npm run build` | Compila `src/` a JavaScript en `dist/` |
| `npm start` | Producción: ejecuta lo compilado en `dist/` |

## Cómo obtener el ID del grupo

1. Pon `LOG_UPDATES=true` en `.env`.
2. Ejecuta `npm run dev` y escribe cualquier mensaje en el grupo.
3. En la consola aparecerá `Chat ID: -100...`. Cópialo en `ALLOWED_GROUP_ID`.
4. Vuelve a poner `LOG_UPDATES=false`.

## Cómo genera el OXXO

1. Abre el link del monto en Chromium (sin ventana). Chromium se abre una sola vez al arrancar; cada petición usa un contexto nuevo que se cierra al terminar.
2. Llena "Información del cliente" con datos fijos (Gera Mexi, mexioferta@gmail.com, +52 9841055603) y elige **Efectivo - OXXO**.
3. **Antes de pulsar "Procesar pago"** revisa que cada campo, el prefijo +52 y el método OXXO hayan quedado bien. Si algo no cuadra, se detiene sin crear la orden.
4. Pulsa **Procesar pago** y espera a que aparezcan la referencia, el código de barras y el logo.
5. **Antes de enviar la imagen** consulta a Ecart Pay la orden guardada y confirma nombre, correo, teléfono (52 + 10 dígitos), monto, moneda, pago en efectivo OXXO pendiente y que la referencia sea la misma que se ve en pantalla. Si algo no cuadra, no envía la imagen.
6. Captura el voucher desde el precio hasta la fila "Orden" (sin "Pagar antes de").

Para ir más rápido bloquea la analítica y la publicidad (Google Tag Manager, Analytics, Ads, Clarity, Hotjar, Facebook, LinkedIn…) y guarda en memoria los archivos estáticos del checkout. En la consola queda el tiempo de cada petición:

```
[oxxo] $490 para Ana: enviado en 8.6s (fila 0.0 · carga 3.7 · datos 0.3 · procesar 3.4 · captura 0.1 · Telegram 1.1) ref 93007564759762
```

Si algo falla, el bot avisa en el chat y guarda una captura de la página en `debug/`. Si la falla fue por un **captcha**, el mensaje lo dice ("captcha detectado en la página de pagos. Por favor inténtalo más tarde") y la captura termina en `_captcha.png`. Solo se culpa al captcha cuando de verdad hubo uno: una ventana de captcha (reCAPTCHA o hCaptcha), Cloudflare pidiendo verificación, o la página atorada con un captcha en pantalla. Cualquier otro error muestra el mensaje normal. Si un OXXO tarda más de 2 minutos en total, se cancela para que la fila siga avanzando. Los datos del cliente y los selectores de la página están al inicio de `src/services/oxxoVoucher.ts`: si Ecart Pay cambia su checkout, ahí es donde hay que ajustar.

> El bot necesita ser **administrador** del grupo con el permiso **Eliminar mensajes**: así lee todos los mensajes y puede borrar los que no son montos.

## Limpieza semanal de capturas

Cada falla guarda una captura en `debug/`. Para que no se acumulen, **cada domingo a las 4:00 (hora de la Ciudad de México)** el bot borra todas las capturas de esa carpeta, así ninguna vive más de una semana. La hora y la zona horaria están en `CLEANUP_HOUR` y `CLEANUP_TIMEZONE`, al inicio de `src/index.ts`; la zona es fija, así que funciona igual aunque el servidor esté en UTC (como Render).

- Si borró al menos una captura, avisa en el grupo: `🧹 Limpieza semanal: se eliminaron N capturas de OXXO.` Si no había nada que borrar, no manda nada (para no escribir cada domingo).
- La limpieza **usa la misma fila que los OXXO** (`runExclusive`), de uno en uno: mientras limpia no se genera ningún OXXO, y los que lleguen en ese momento esperan su turno. Borrar unos cuantos archivos tarda milisegundos, así que la espera es imperceptible.

## Estructura

```
├── data/
│   ├── paymentLinks.json          ← links reales (no se sube)
│   └── paymentLinks.example.json  ← plantilla
├── src/
│   ├── index.ts                   ← punto de entrada: arranque y apagado
│   ├── bot.ts                     ← crea el bot y registra middlewares y handlers
│   ├── config.ts                  ← lee y valida .env y los links
│   ├── middlewares/
│   │   ├── onlyAllowedGroup.ts    ← solo deja pasar el grupo VIP
│   │   ├── deleteOtherMessages.ts ← borra lo que no es un monto (también a los admins)
│   │   └── logUpdates.ts          ← muestra el Chat ID (si LOG_UPDATES=true)
│   ├── handlers/
│   │   └── payment.ts             ← monto → mensaje "cargando" → imagen del OXXO
│   ├── services/
│   │   └── oxxoVoucher.ts         ← Playwright: llena el checkout y captura el voucher
│   └── utils/
│       ├── taskQueue.ts           ← fila: una petición a la vez, en orden de llegada
│       └── weeklyCleanup.ts       ← programa la limpieza de capturas cada domingo
├── debug/                         ← capturas cuando algo falla (no se sube)
├── .env.example
└── tsconfig.json
```

## Despliegue en Render

Render con Playwright necesita Docker (el entorno normal no puede instalar Chromium). El repo ya trae `Dockerfile` (imagen oficial de Playwright con Chromium) y `render.yaml`.

1. Sube el repo a GitHub.
2. En Render crea un **Background Worker** (no un Web Service: el bot no abre ningún puerto) conectado al repo. Si usas el *Blueprint* (`render.yaml`), Render lo configura solo.
3. En **Environment**, define las variables: `BOT_TOKEN`, `ALLOWED_GROUP_ID` y `PAYMENT_LINKS` (el JSON de los links en una sola línea). `HEADLESS=true`.
4. Deja **una sola instancia**: Telegram solo permite un bot leyendo los mensajes a la vez (dos darían error `409`). Por lo mismo, apaga el bot de tu PC antes de dejar corriendo el del servidor.

Para sacar el JSON de una línea desde tu archivo local:

```bash
node -e "process.stdout.write(JSON.stringify(require('./data/paymentLinks.json')))"
```

Copia lo que imprime y pégalo tal cual en el valor de `PAYMENT_LINKS` en Render.

> Si cambian los links, actualiza `PAYMENT_LINKS` en Render y reinicia el servicio.

## Seguridad

Si el token llega a publicarse por error, genera uno nuevo en @BotFather con `/revoke`. Borrar el commit no basta, porque el token queda en el historial de git.
