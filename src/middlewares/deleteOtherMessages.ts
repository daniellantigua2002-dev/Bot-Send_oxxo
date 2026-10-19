import type { Context, MiddlewareFn } from 'telegraf';

// Lo que puede mandar una persona. Los mensajes de servicio ("X se unió al grupo", mensaje fijado...) no se tocan.
const USER_CONTENT = [
    'text', 'photo', 'video', 'animation', 'document', 'audio', 'voice', 'video_note',
    'sticker', 'contact', 'location', 'venue', 'poll', 'dice', 'story', 'game', 'paid_media',
] as const;

/**
 * Borra los mensajes que llegan hasta aquí: texto que no es un monto, fotos, stickers, archivos, etc.
 * Va al final de la cadena, así solo le llega lo que ningún handler atendió.
 * También borra los de los administradores: un error de teclado no debe quedarse en el grupo.
 */
export const deleteOtherMessages: MiddlewareFn<Context> = async (ctx) => {
    const msg = ctx.message;
    if (!msg || !USER_CONTENT.some((type) => type in msg)) {
        return;
    }

    try {
        await ctx.deleteMessage();
    } catch (err) {
        // Lo más común: el bot no tiene el permiso "Eliminar mensajes" en el grupo
        console.error(`No se pudo borrar el mensaje de ${msg.from?.first_name ?? 'desconocido'}:`, err instanceof Error ? err.message : err);
    }
};
