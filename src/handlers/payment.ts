import { setTimeout as sleep } from 'node:timers/promises';
import { Composer, TelegramError, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { PaymentLinks } from '../config.ts';
import { CaptchaError, type VoucherGenerator, type VoucherStep, type VoucherTimings } from '../services/oxxoVoucher.ts';

/** Pasos del mensaje "cargando": los del OXXO y, al final, el envío de la imagen. */
type ProgressStage = VoucherStep | 'sending';

/**
 * Porcentaje de cada paso: arranca en `from` y, mientras el paso dura, avanza solo hacia `to`
 * (cada vez más lento, sin llegar), para que el número no se quede quieto en las esperas largas.
 */
const PROGRESS: Record<ProgressStage, { from: number; to: number; label: string }> = {
    opening: { from: 5, to: 29, label: 'Abriendo el pago…' },
    filling: { from: 30, to: 44, label: 'Llenando los datos…' },
    processing: { from: 45, to: 74, label: 'Generando tu referencia OXXO…' },
    verifying: { from: 75, to: 84, label: 'Verificando tu orden…' },
    capturing: { from: 85, to: 94, label: 'Preparando tu voucher…' },
    sending: { from: 95, to: 99, label: 'Enviando tu OXXO…' },
};

const PROGRESS_BAR_LENGTH = 10;

/** Cada cuánto se edita el mensaje "cargando". Más seguido arriesga el límite de Telegram (error 429) en el grupo. */
const PROGRESS_TICK_MS = 2_000;

/** Qué tan rápido avanza el porcentaje dentro de un paso: a los 4 s lleva ~63 % del camino hacia `to`. */
const PROGRESS_CREEP_MS = 4_000;

/** Si Telegram pide esperar más que esto para enviar la imagen, no se reintenta. */
const MAX_FLOOD_WAIT_MS = 30_000;

/** Reacción que se pone al mensaje del monto cuando su OXXO se envió bien. */
const SENT_REACTION = '👍';

/** Columnas de la tabla de montos disponibles (4 caben bien en la pantalla de un celular). */
const TABLE_COLUMNS = 4;

const amountFormat = new Intl.NumberFormat('es-MX');

/**
 * Normaliza lo que escribe el usuario: "$1,089.00" → "1089", " 4 90 " → "490", "0490" → "490".
 * Devuelve null si el texto no parece un monto.
 */
export function parseAmount(text: string): string | null {
    // \s cubre espacios, saltos de línea y tabuladores; ​-‍ y ⁠ son caracteres
    // invisibles que a veces se cuelan al copiar y pegar
    const cleaned = text.replace(/[\s$,​-‍⁠]/g, '').replace(/\.0+$/, '');
    if (!/^\d{1,7}$/.test(cleaned)) {
        return null;
    }
    return String(Number(cleaned));
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
}

/** "1089" → "$1,089" */
function formatMoney(amount: string): string {
    return `$${amountFormat.format(Number(amount))}`;
}

/** Montos ordenados de menor a mayor, en columnas alineadas (se muestra con letra monoespaciada). */
function formatAmountTable(amounts: string[]): string {
    const cells = amounts.map(formatMoney);
    const width = Math.max(...cells.map((cell) => cell.length));
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += TABLE_COLUMNS) {
        rows.push(cells.slice(i, i + TABLE_COLUMNS).map((cell) => cell.padStart(width)).join('  '));
    }
    return rows.join('\n');
}

function seconds(ms: number): string {
    return (ms / 1000).toFixed(1);
}

function formatTimings(t: VoucherTimings, telegramMs: number): string {
    return `fila ${seconds(t.queue)} · carga ${seconds(t.load)} · datos ${seconds(t.form)} · procesar ${seconds(t.process)} · captura ${seconds(t.capture)} · Telegram ${seconds(telegramMs)}`;
}

/** Porcentaje de un paso que lleva `elapsedMs` en curso. */
function progressPercent(stage: ProgressStage, elapsedMs: number): number {
    const { from, to } = PROGRESS[stage];
    return Math.floor(from + (to - from) * (1 - Math.exp(-elapsedMs / PROGRESS_CREEP_MS)));
}

/** "▰▰▰▰▰▱▱▱▱▱  45%" y debajo lo que se está haciendo. */
function formatProgress(stage: ProgressStage, percent: number): string {
    const filled = Math.round((percent / 100) * PROGRESS_BAR_LENGTH);
    return `${'▰'.repeat(filled)}${'▱'.repeat(PROGRESS_BAR_LENGTH - filled)}  ${percent}%\n${PROGRESS[stage].label}`;
}

/** Milisegundos que Telegram pide esperar si respondió 429 (demasiadas peticiones); null si fue otro error. */
function floodWaitMs(err: unknown): number | null {
    return err instanceof TelegramError && err.code === 429 ? (err.parameters?.retry_after ?? 1) * 1000 : null;
}

/** Si Telegram pide esperar, espera lo que indica y lo intenta una vez más. */
async function retryOnFlood<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (err) {
        const waitMs = floodWaitMs(err);
        if (waitMs === null || waitMs > MAX_FLOOD_WAIT_MS) {
            throw err;
        }
        await sleep(waitMs);
        return call();
    }
}

type VoucherRequest = {
    amount: string;
    link: string;
    userName: string;
    messageId: number;
};

/**
 * Genera un OXXO nuevo y lo envía como imagen con el nombre del usuario. Mientras tanto muestra un mensaje "cargando" que se borra al final.
 * Nunca lanza errores: los atrapa y avisa en el chat.
 */
async function sendVoucher(ctx: Context, vouchers: VoucherGenerator, request: VoucherRequest): Promise<void> {
    const { amount, link, userName, messageId } = request;
    const startedAt = performance.now();
    const replyTo = { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } };
    const header = `⏳ ${userName}, tu OXXO de ${formatMoney(amount)} se está cargando…`;

    const ahead = vouchers.pending;
    // Paso en curso; null mientras espera en la fila
    let stage: ProgressStage | null = ahead > 0 ? null : 'opening';
    let stageStartedAt = performance.now();
    const setStage = (next: ProgressStage) => {
        stage = next;
        stageStartedAt = performance.now();
    };

    let shownText = stage === null
        ? `${header}\nEn fila: ${ahead} ${ahead === 1 ? 'persona' : 'personas'} antes que tú.`
        : `${header}\n${formatProgress(stage, PROGRESS[stage].from)}`;
    const loading = ctx.reply(shownText, replyTo).catch(() => null);

    // El mensaje se edita a ritmo fijo y no cada vez que cambia el paso, para no pasarse del límite de Telegram.
    // Una edición a la vez: si la anterior no ha terminado, se salta este turno
    let editing: Promise<void> | null = null;
    let pausedUntil = 0;
    const ticker = setInterval(() => {
        if (stage === null || editing || performance.now() < pausedUntil) {
            return;
        }
        const text = `${header}\n${formatProgress(stage, progressPercent(stage, performance.now() - stageStartedAt))}`;
        if (text === shownText) {
            return;
        }
        shownText = text;
        editing = loading
            .then((msg) => msg && ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, text))
            .then(
                () => {},
                (err: unknown) => {
                    // Si una edición falla no importa: es solo informativa. Si Telegram pide esperar, se le hace caso
                    pausedUntil = performance.now() + (floodWaitMs(err) ?? 0);
                },
            )
            .finally(() => {
                editing = null;
            });
    }, PROGRESS_TICK_MS);

    try {
        // Se llama sin esperar nada antes, así el lugar en la fila respeta el orden de los mensajes
        const voucher = await vouchers.generate(link, amount, setStage);

        setStage('sending');
        const sendStartedAt = performance.now();
        // El texto solo dice para quién es: la referencia ya aparece en el voucher
        const caption = `✅ ${userName}, aquí está tu OXXO de ${formatMoney(amount)}`;
        // La orden ya se creó en Ecart Pay: si Telegram pide esperar, vale la pena reintentar en vez de perderla
        await retryOnFlood(() => ctx.replyWithPhoto({ source: voucher.image, filename: `oxxo-${amount}.png` }, { ...replyTo, caption }));
        const telegramMs = performance.now() - sendStartedAt;
        console.log(`[oxxo] $${amount} para ${userName}: enviado en ${seconds(performance.now() - startedAt)}s (${formatTimings(voucher.timings, telegramMs)}) ref ${voucher.reference}`);

        // Reacción al mensaje del monto (no es un mensaje nuevo). Si falla, el OXXO ya se envió: solo se registra
        await ctx.react(SENT_REACTION).catch((err: unknown) => {
            console.error(`[oxxo] No se pudo reaccionar al mensaje de ${userName}:`, err instanceof Error ? err.message : err);
        });
    } catch (err) {
        const captcha = err instanceof CaptchaError;
        console.error(`[oxxo] $${amount} para ${userName}: ${captcha ? 'CAPTCHA detectado' : 'error'} tras ${seconds(performance.now() - startedAt)}s.`, err instanceof Error ? err.message : err);
        const text = captcha
            ? `⚠️ ${userName}, no se pudo enviar tu OXXO de ${formatMoney(amount)}: captcha detectado en la página de pagos. Por favor inténtalo más tarde.`
            : `❌ ${userName}, no se pudo generar tu OXXO de ${formatMoney(amount)}. Intenta de nuevo en un momento.`;
        await ctx.reply(text, replyTo).catch(() => {});
    } finally {
        clearInterval(ticker);
        await editing;
        const msg = await loading;
        if (msg) {
            await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        }
    }
}

/** Responde con la imagen de un OXXO recién generado para el monto escrito. */
export function paymentHandler(paymentLinks: PaymentLinks, vouchers: VoucherGenerator) {
    const composer = new Composer();
    const amounts = Object.keys(paymentLinks).sort((a, b) => Number(a) - Number(b));
    const amountTable = formatAmountTable(amounts);

    composer.on(message('text'), async (ctx, next) => {
        const amount = parseAmount(ctx.message.text);
        if (amount === null) {
            // No es un monto (ej. "hola", "gracias"): pasa al siguiente middleware, que lo borra
            return next();
        }

        const userName = ctx.from?.first_name ?? 'Usuario';
        const link = paymentLinks[amount];

        if (!link) {
            await ctx.reply(
                `❌ ${escapeHtml(userName)}, el monto <b>${formatMoney(amount)}</b> no está disponible.\n\n`
                + `📋 <b>Montos disponibles:</b>\n<pre>${amountTable}</pre>\n`
                + `✍️ Escribe solo el número, por ejemplo: <b>${amounts[0] ?? '490'}</b>`,
                { parse_mode: 'HTML', reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } },
            );
            return;
        }

        // Sin await a propósito: Telegraf no lee mensajes nuevos hasta que el handler termina,
        // así los demás pueden entrar a la fila mientras este OXXO se genera
        void sendVoucher(ctx, vouchers, { amount, link, userName, messageId: ctx.message.message_id });
    });

    return composer;
}
