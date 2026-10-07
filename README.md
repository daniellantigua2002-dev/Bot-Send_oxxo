# Bot de Telegram – Links de pago OXXO

Bot de Telegram que responde con el link de pago OXXO correspondiente al monto que escribe el usuario. Solo funciona dentro del grupo VIP autorizado.

```
Usuario:  490
Bot:      Ana, aquí está tu OXXO de $490:
          https://pay.ecart.com/payment_link/...
```

- Acepta montos como `490`, `$490`, `1,089` o `1089.00`.
- Ignora los mensajes que no son montos, para no hacer spam en el grupo.
- En chats privados responde "Acceso denegado". En otros grupos no responde.

## Requisitos

- [Node.js](https://nodejs.org/) 22.18 o superior (recomendado: 24 LTS)
- Un bot creado con [@BotFather](https://t.me/BotFather)

## Instalación

```bash
npm install
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
| `LOG_UPDATES` | `true` para ver en consola el Chat ID de cada mensaje |

Y en `data/paymentLinks.json` pon tus montos y links:

```json
{
  "490": "https://pay.ecart.com/payment_link/..."
}
```

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

> El bot necesita ser **administrador** del grupo (o tener desactivado el *privacy mode* en @BotFather) para leer todos los mensajes.

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
│   │   └── logUpdates.ts          ← muestra el Chat ID (si LOG_UPDATES=true)
│   └── handlers/
│       └── payment.ts             ← monto → link de pago
├── .env.example
└── tsconfig.json
```

## Seguridad

Si el token llega a publicarse por error, genera uno nuevo en @BotFather con `/revoke`. Borrar el commit no basta, porque el token queda en el historial de git.
