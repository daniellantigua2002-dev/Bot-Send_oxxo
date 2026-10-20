# Bot de Telegram – OXXO de Ecart Pay

Bot de Telegram que genera pagos en efectivo OXXO a partir de los links de pago de Ecart Pay. El usuario escribe un monto en el grupo y el bot responde con la imagen del voucher. Funciona solo dentro del grupo VIP autorizado.

## Funcionalidades

- Acepta montos como `490`, `$490`, `1,089` o `1089.00`.
- Cada petición crea una orden nueva en Ecart Pay.
- Atiende una petición a la vez, en orden de llegada, e indica la posición en la fila.
- Si el monto no existe, responde con la tabla de montos disponibles.
- Borra los mensajes que no son montos (texto, fotos, videos, stickers, archivos y audios), incluidos los de administradores.
- Limpia cada semana las capturas de error.
- En chats privados responde "Acceso denegado" y en otros grupos no responde.

## Requisitos

- [Node.js](https://nodejs.org/) 22.18 o superior (recomendado: 24 LTS)
- Un bot creado con [@BotFather](https://t.me/BotFather)
- Chromium de Playwright

## Instalación

```bash
npm install
npx playwright install chromium
cp .env.example .env
cp data/paymentLinks.example.json data/paymentLinks.json
```

## Configuración

| Variable | Descripción |
|---|---|
| `BOT_TOKEN` | Token del bot generado por @BotFather |
| `ALLOWED_GROUP_ID` | ID del grupo VIP (los supergrupos empiezan con `-100`) |
| `PAYMENT_LINKS` | *(Opcional en local)* Links de pago en JSON de una sola línea. Tiene prioridad sobre `data/paymentLinks.json` |
| `LOG_UPDATES` | `true` muestra en consola el Chat ID de cada mensaje |
| `HEADLESS` | `false` muestra la ventana de Chromium (solo depuración). Por defecto `true` |

Formato de `data/paymentLinks.json`:

```json
{
  "490": "https://pay.ecart.com/payment_link/..."
}
```

Prioridad de los links:

1. Variable de entorno `PAYMENT_LINKS` (servidor).
2. Archivo `data/paymentLinks.json` (local).

> `.env` y `data/paymentLinks.json` están en `.gitignore`.

El bot debe ser **administrador** del grupo con el permiso **Eliminar mensajes**.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Desarrollo con recarga automática |
| `npm run typecheck` | Verificación de tipos |
| `npm run build` | Compila `src/` a `dist/` |
| `npm start` | Ejecuta la versión compilada |



## Generación del OXXO

1. Abre el link del monto en Chromium sin interfaz. Cada petición usa un contexto aislado.
2. Llena la información del cliente y selecciona **Efectivo - OXXO**.
3. Valida los datos antes de procesar el pago; si algo no coincide, cancela sin crear la orden.
4. Procesa el pago y espera la referencia y el código de barras.
5. Verifica la orden en Ecart Pay antes de enviar la imagen.
6. Captura el voucher y lo envía al grupo.

Los datos del cliente y los selectores del checkout están en `src/services/oxxoVoucher.ts`.

### Errores

- Si algo falla, el bot avisa en el chat y guarda una captura en `debug/`.
- Si la falla es por un captcha, el aviso lo indica y la captura termina en `_captcha.png`.
- Las peticiones que tardan más de 2 minutos se cancelan.

## Limpieza semanal

Cada domingo a las 4:00 (hora de la Ciudad de México) se borran las capturas de `debug/`. Si se eliminó alguna, se avisa en el grupo. La hora y la zona horaria se configuran en `CLEANUP_HOUR` y `CLEANUP_TIMEZONE` (`src/index.ts`).

## Estructura

```
├── data/
│   ├── paymentLinks.json
│   └── paymentLinks.example.json
├── src/
│   ├── index.ts
│   ├── servidor.ts
│   ├── bot.ts
│   ├── config.ts
│   ├── middlewares/
│   │   ├── onlyAllowedGroup.ts
│   │   ├── deleteOtherMessages.ts
│   │   └── logUpdates.ts
│   ├── handlers/
│   │   └── payment.ts
│   ├── services/
│   │   └── oxxoVoucher.ts
│   └── utils/
│       ├── taskQueue.ts
│       └── weeklyCleanup.ts
├── debug/
├── .env.example
└── tsconfig.json
```

## Despliegue en Render

Se despliega como **Web Service** (plan **Free**, runtime **Docker**). El bot incluye un servidor de salud (`src/servidor.ts`) que escucha en `PORT` (10000 por defecto) y responde `200 OK` en `/`.

1. Crear el Web Service conectado al repositorio.
2. Definir en **Environment**: `BOT_TOKEN`, `ALLOWED_GROUP_ID`, `PAYMENT_LINKS` y `HEADLESS=true`.
3. Detener cualquier instancia local antes de desplegar.

Para generar `PAYMENT_LINKS` desde el archivo local:

```bash
node -e "process.stdout.write(JSON.stringify(require('./data/paymentLinks.json')))"
```

Si cambian los links, actualizar `PAYMENT_LINKS` en Render y reiniciar el servicio.

> **Plan gratuito:** 512 MB de RAM .
