import { createBot } from './bot.ts';
import { loadConfig } from './config.ts';
import { startHealthServer } from './servidor.ts';
import { cleanupDebugScreenshots, createVoucherGenerator } from './services/oxxoVoucher.ts';
import { scheduleWeeklyTask } from './utils/weeklyCleanup.ts';

/** Cada domingo a esta hora (de la Ciudad de México) se borran las capturas de `debug/`. */
const CLEANUP_HOUR = 4;
const CLEANUP_TIMEZONE = 'America/Mexico_City';

async function main(): Promise<void> {
    // Render (Web Service) exige un puerto abierto: se abre de inmediato, antes del resto del arranque.
    // Corre aparte del long polling de Telegram, sin afectarlo.
    startHealthServer();

    const config = loadConfig();
    // Chromium se abre una sola vez al arrancar, así la primera petición no espera a que inicie
    const vouchers = await createVoucherGenerator({ headless: config.headless });
    const bot = createBot(config, vouchers);

    // Limpieza semanal de capturas: así ninguna dura más de una semana. Entra a la misma fila que
    // los OXXO (uno a la vez), por eso mientras limpia no se genera ningún OXXO y los que lleguen esperan.
    const cleanup = scheduleWeeklyTask({
        hour: CLEANUP_HOUR,
        timeZone: CLEANUP_TIMEZONE,
        run: () => vouchers.runExclusive(cleanupDebugScreenshots),
        onDone: async (deleted) => {
            console.log(`[limpieza] domingo: ${deleted} captura(s) de debug/ eliminada(s)`);
            // Solo se avisa en el grupo si de verdad se borró algo, para no mandar un mensaje cada domingo
            if (deleted > 0) {
                const plural = deleted === 1 ? '' : 's';
                await bot.telegram
                    .sendMessage(config.allowedGroupId, `🧹 Limpieza semanal: se eliminaron ${deleted} captura${plural} de OXXO.`)
                    .catch((err: unknown) => console.error('[limpieza] no se pudo avisar en el grupo:', err instanceof Error ? err.message : err));
            }
        },
        onError: (err) => console.error('[limpieza] falló la limpieza semanal:', err instanceof Error ? err.message : err),
    });

    // Apagado limpio
    const shutdown = (signal: string) => {
        cleanup.stop();
        bot.stop(signal);
        void vouchers.close();
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    // launch() solo termina cuando el bot se detiene, por eso el aviso va en el callback
    await bot.launch(() => {
        console.log(`Bot @${bot.botInfo?.username} encendido. Escuchando el grupo ${config.allowedGroupId}...`);
    });
}

main().catch((err: unknown) => {
    console.error('Error al iniciar el bot:', err instanceof Error ? err.message : err);
    process.exit(1);
});
