import { createServer } from 'node:http';

/** Puerto por defecto si Render no inyecta PORT (en local). */
const DEFAULT_PORT = 10000;

/**
 * Servidor HTTP mínimo para la verificación de salud de Render.
 * El plan Web Service exige un puerto abierto; esto lo satisface sin tocar el bot:
 * responde 200 "OK" en cualquier ruta (incluida "/", que usa Render como health check).
 * Corre aparte del long polling de Telegram, que no usa puertos de entrada.
 */
export function startHealthServer(): void {
    const port = Number(process.env.PORT) || DEFAULT_PORT;
    const server = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('OK');
    });
    server.on('error', (err) => {
        console.error('Error en la página de salud:', err instanceof Error ? err.message : err);
    });
    server.listen(port, () => {
        console.log(`Página de salud en el puerto ${port}`);
    });
}
