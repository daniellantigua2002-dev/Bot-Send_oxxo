import type { Context, MiddlewareFn } from 'telegraf';

/**
 * Deja pasar solo los updates del grupo VIP autorizado.
 * Todo lo que se registre después de este middleware queda protegido.
 */
export function onlyAllowedGroup(allowedGroupId: number): MiddlewareFn<Context> {
    return async (ctx, next) => {
        if (ctx.chat?.id === allowedGroupId) {
            return next();
        }

        // Solo se responde a mensajes en privado; otros updates (ej. si el usuario bloquea al bot) se ignoran
        if (ctx.chat?.type === 'private' && ctx.message) {
            await ctx.reply('Acceso denegado. Este bot solo responde consultas dentro del grupo VIP autorizado.');
        }
        // Sin next(): el update se detiene aquí
    };
}
