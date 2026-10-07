import { Composer } from 'telegraf';
import { message } from 'telegraf/filters';
import type { PaymentLinks } from '../config.ts';

/**
 * Normaliza lo que escribe el usuario: "$1,089.00" → "1089", "0490" → "490".
 * Devuelve null si el texto no parece un monto.
 */
export function parseAmount(text: string): string | null {
    const cleaned = text.replace(/[\s$,]/g, '').replace(/\.0+$/, '');
    if (!/^\d{1,7}$/.test(cleaned)) {
        return null;
    }
    return String(Number(cleaned));
}

/** Responde con el link de pago OXXO correspondiente al monto escrito. */
export function paymentHandler(paymentLinks: PaymentLinks) {
    const composer = new Composer();

    composer.on(message('text'), async (ctx, next) => {
        const amount = parseAmount(ctx.message.text);
        if (amount === null) {
            // No es un monto (ej. "hola", "gracias"): se ignora para no hacer spam en el grupo
            return next();
        }

        const userName = ctx.from?.first_name ?? 'Usuario';
        const link = paymentLinks[amount];

        if (link) {
            await ctx.reply(`${userName}, aquí está tu OXXO de $${amount}:\n\n${link}`);
        } else {
            await ctx.reply(`${userName}, el monto $${amount} no fue encontrado. Por favor escribe únicamente un número válido (ejemplo: 490, 790, 1089).`);
        }
    });

    return composer;
}
