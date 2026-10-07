import type { Context, MiddlewareFn } from 'telegraf';

/** Imprime el Chat ID de cada update. Útil para obtener el ID de un grupo nuevo. */
export const logUpdates: MiddlewareFn<Context> = (ctx, next) => {
    console.log(`[update] ${ctx.updateType} desde Chat ID: ${ctx.chat?.id} (Tipo: ${ctx.chat?.type})`);
    return next();
};
