import { readFileSync } from 'node:fs';

/** Monto como texto (ej. "490") → link de pago. */
export type PaymentLinks = Record<string, string>;

export type Config = {
    botToken: string;
    allowedGroupId: number;
    paymentLinks: PaymentLinks;
    logUpdates: boolean;
};

// Se resuelve relativo a este archivo, así funciona igual desde src/ (dev) que desde dist/ (producción)
const PAYMENT_LINKS_FILE = new URL('../data/paymentLinks.json', import.meta.url);

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

function loadPaymentLinks(): PaymentLinks {
    let raw: string;
    try {
        raw = readFileSync(PAYMENT_LINKS_FILE, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error('No se encontró data/paymentLinks.json. Copia data/paymentLinks.example.json y pon tus links reales.');
        }
        throw err;
    }

    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('data/paymentLinks.json debe ser un objeto { "monto": "link" }');
    }

    for (const [amount, link] of Object.entries(data)) {
        if (!/^\d+$/.test(amount) || typeof link !== 'string' || !URL.canParse(link)) {
            throw new Error(`Entrada inválida en data/paymentLinks.json: "${amount}"`);
        }
    }

    return data as PaymentLinks;
}

export function loadConfig(): Config {
    return {
        botToken: requireEnv('BOT_TOKEN'),
        allowedGroupId: parseGroupId(requireEnv('ALLOWED_GROUP_ID')),
        paymentLinks: loadPaymentLinks(),
        logUpdates: process.env.LOG_UPDATES?.trim().toLowerCase() === 'true',
    };
}
