import { readFileSync } from 'node:fs';

/** Monto como texto (ej. "490") → link de pago. */
export type PaymentLinks = Record<string, string>;

export type Config = {
    botToken: string;
    allowedGroupId: number;
    paymentLinks: PaymentLinks;
    logUpdates: boolean;
    headless: boolean;
};

// Se resuelve relativo a este archivo, así funciona igual desde src/ (dev) que desde dist/ (producción)
const PAYMENT_LINKS_FILE = new URL('../data/paymentLinks.json', import.meta.url);

// En el servidor (Render) los links van aquí, así el archivo con los links reales no se sube a git
const PAYMENT_LINKS_ENV = 'PAYMENT_LINKS';

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env (usa .env.example como guía).`);
    }
    return value;
}

function parseGroupId(raw: string): number {
    const id = Number(raw);
    if (!Number.isSafeInteger(id)) {
        throw new Error(`ALLOWED_GROUP_ID no es un número válido: "${raw}"`);
    }
    return id;
}

/** Valida y convierte el JSON de los links (venga del archivo o de la variable de entorno). */
function parsePaymentLinks(raw: string, source: string): PaymentLinks {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error(`${source} no es un JSON válido. Debe ser un objeto { "monto": "link" }.`);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error(`${source} debe ser un objeto { "monto": "link" }.`);
    }
    for (const [amount, link] of Object.entries(data)) {
        if (!/^\d+$/.test(amount) || typeof link !== 'string' || !URL.canParse(link)) {
            throw new Error(`Entrada inválida en ${source}: "${amount}".`);
        }
    }
    return data as PaymentLinks;
}

function loadPaymentLinks(): PaymentLinks {
    // En el servidor los links vienen en la variable PAYMENT_LINKS (tiene prioridad sobre el archivo)
    const fromEnv = process.env[PAYMENT_LINKS_ENV]?.trim();
    if (fromEnv) {
        return parsePaymentLinks(fromEnv, `la variable ${PAYMENT_LINKS_ENV}`);
    }

    // En local se lee data/paymentLinks.json
    let raw: string;
    try {
        raw = readFileSync(PAYMENT_LINKS_FILE, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `No se encontró data/paymentLinks.json ni la variable ${PAYMENT_LINKS_ENV}. `
                + 'En local: copia data/paymentLinks.example.json y pon tus links. '
                + `En el servidor: define la variable ${PAYMENT_LINKS_ENV} con el JSON de los links.`,
            );
        }
        throw err;
    }
    return parsePaymentLinks(raw, 'data/paymentLinks.json');
}

export function loadConfig(): Config {
    return {
        botToken: requireEnv('BOT_TOKEN'),
        allowedGroupId: parseGroupId(requireEnv('ALLOWED_GROUP_ID')),
        paymentLinks: loadPaymentLinks(),
        logUpdates: process.env.LOG_UPDATES?.trim().toLowerCase() === 'true',
        // Solo se desactiva escribiendo "false" (útil para ver el navegador al depurar)
        headless: process.env.HEADLESS?.trim().toLowerCase() !== 'false',
    };
}
