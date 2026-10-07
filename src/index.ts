import { createBot } from './bot.ts';
import { loadConfig } from './config.ts';

async function main(): Promise<void> {
    const config = loadConfig();
    const bot = createBot(config);

    // Apagado limpio
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    // launch() solo termina cuando el bot se detiene, por eso el aviso va en el callback
    await bot.launch(() => {
        console.log(`Bot @${bot.botInfo?.username} encendido. Escuchando el grupo ${config.allowedGroupId}...`);
    });
}

main().catch((err: unknown) => {
    console.error('Error al iniciar el bot:', err instanceof Error ? err.message : err);
    process.exit(1);
});
