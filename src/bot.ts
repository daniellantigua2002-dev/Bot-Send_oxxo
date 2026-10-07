import { Telegraf } from 'telegraf';
import type { Config } from './config.ts';
import { paymentHandler } from './handlers/payment.ts';
import { logUpdates } from './middlewares/logUpdates.ts';
import { onlyAllowedGroup } from './middlewares/onlyAllowedGroup.ts';

export function createBot(config: Config): Telegraf {
    const bot = new Telegraf(config.botToken);

    // Va antes del filtro de grupo para poder ver el ID de cualquier chat
    if (config.logUpdates) {
        bot.use(logUpdates);
    }

    // El guardia: todo lo registrado después solo funciona en el grupo VIP
    bot.use(onlyAllowedGroup(config.allowedGroupId));

    bot.use(paymentHandler(config.paymentLinks));

    // Si algo falla (Telegram caído, límite de mensajes, bot silenciado...) se registra sin tumbar el bot
    bot.catch((err, ctx) => {
        console.error(`Error procesando el update ${ctx.update.update_id} (${ctx.updateType}):`, err);
    });

    return bot;
}
