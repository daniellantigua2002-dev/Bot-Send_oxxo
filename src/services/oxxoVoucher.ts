import { mkdir, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, errors, type Browser, type Locator, type Page, type Response } from 'playwright';
import { TaskQueue } from '../utils/taskQueue.ts';

/** Datos fijos con los que se llena "Información del cliente". */
const CUSTOMER = {
    firstName: 'Gera',
    lastName: 'Mexi',
    email: 'mexioferta@gmail.com',
    phone: '9841055603', // 10 dígitos; el prefijo +52 se elige aparte
} as const;

/** Selectores del checkout de Ecart Pay. Si Ecart cambia su página, aquí es donde hay que ajustar. */
const SELECTORS = {
    firstName: '#first_name',
    lastName: '#last_name',
    email: '#email',
    phone: '#phone',
    countryDropdown: '.vti__dropdown',
    countryMexico: '.vti__dropdown-item:has(.vti__flag.mx)',
    paymentMethod: '.payment-method-selector .list-group-item',
    paymentRadio: 'input[type=radio]',
    voucher: '.success-content',
    reference: '.reference-text',
    barcode: 'img.barcode',
    voucherImages: '.cash-method img',
    price: '.amount-container', // la captura empieza en el precio
    detailLabel: '.order-details .detail-label', // ...y termina en la fila "Orden:"
} as const;

const OXXO_METHOD_NAME = 'Efectivo - OXXO';
const ORDER_LABEL = 'Orden';

// Lo que muestra Ecart cuando el enlace de pago no existe o fue desactivado
const LINK_NOT_FOUND_TEXT = /template does not exist/i;

// Ventanas de captcha que solo aparecen cuando le piden algo a la persona (elegir imágenes, etc.).
// Si una se ve, ya no hay nada que esperar
const CAPTCHA_CHALLENGE = [
    'iframe[src*="/recaptcha/"][src*="bframe"]',
    'iframe[src*="hcaptcha.com"][src*="frame=challenge"]',
].join(', ');

// Cualquier captcha: también las casillas "No soy un robot" y Cloudflare Turnstile, que a veces se
// resuelven solas. Estas solo cuentan si la página se quedó atorada mientras estaban en pantalla
const CAPTCHA_ANY = [
    CAPTCHA_CHALLENGE,
    'iframe[src*="/recaptcha/"][src*="anchor"]:not([src*="size=invisible"])',
    'iframe[src*="hcaptcha.com"]',
    'iframe[src*="challenges.cloudflare.com"]',
].join(', ');

/** Tope para todo un OXXO (uno normal tarda unos 10 s). Cada paso tiene su propio límite; este es por si algo se cuelga y frena la fila. */
const VOUCHER_TIMEOUT_MS = 120_000;

// API pública de Ecart Pay: devuelve los datos que quedaron guardados en una orden
const ECART_API = 'https://ecartpay.com/api';

// Analítica y publicidad: solo frenan la carga.
// ip2c.org adivina el país por IP; si responde tarde, cambia el prefijo del teléfono después de elegir México.
const BLOCKED_HOSTS = [
    'googletagmanager.com',
    'google-analytics.com',
    'analytics.google.com',
    'doubleclick.net',
    'googleadservices.com',
    'googlesyndication.com',
    'clarity.ms',
    'hotjar.com',
    'licdn.com',
    'linkedin.com',
    'facebook.net',
    'bing.com',
    'popupsmart.com',
    'cloudflareinsights.com',
    'ip2c.org',
];

// Archivos estáticos que no cambian (los de /assets/ llevan un hash en el nombre). Se guardan en memoria
// para no descargarlos en cada petición: cada contexto nuevo empieza sin caché y page.route la desactiva.
const STATIC_FILES = /^https:\/\/(checkout\.ecartpay\.com\/assets\/|fonts\.gstatic\.com\/|fonts\.googleapis\.com\/css2|cdn\.ecartpay\.com\/img\/)/;
const staticCache = new Map<string, { status: number; headers: Record<string, string>; body: Buffer }>();

// Se resuelve relativo a este archivo, así funciona igual desde src/ (dev) que desde dist/ (producción)
const DEBUG_DIR = new URL('../../debug/', import.meta.url);

/** Una petición a la vez, en orden de llegada. */
const MAX_CONCURRENT = 1;

export type VoucherStep = 'opening' | 'filling' | 'processing' | 'verifying' | 'capturing';

/** Milisegundos por fase. */
export type VoucherTimings = {
    queue: number;
    load: number;
    form: number;
    process: number;
    capture: number;
};

export type Voucher = {
    image: Buffer;
    reference: string;
    timings: VoucherTimings;
};

/** Se lanza solo cuando de verdad hubo un captcha, no por cualquier error. */
export class CaptchaError extends Error {
    override name = 'CaptchaError';
}

export type VoucherGenerator = {
    /** Peticiones en curso + en fila. */
    readonly pending: number;
    /** Genera una orden OXXO nueva en el enlace y devuelve la captura del voucher. */
    generate(link: string, amount: string, onStep?: (step: VoucherStep) => void): Promise<Voucher>;
    /**
     * Ejecuta una tarea de mantenimiento usando la misma fila que los OXXO: mientras corre,
     * ninguna petición se genera, y las que lleguen esperan su turno (una a la vez).
     */
    runExclusive<T>(task: () => Promise<T>): Promise<T>;
    close(): Promise<void>;
};

/** Lo que interesa de GET /api/checkout/:id */
type EcartCheckout = {
    order?: {
        first_name?: string;
        last_name?: string;
        email?: string;
        phone?: string;
        currency?: string;
        totals?: { total?: number };
    };
};

/** Lo que interesa de GET /api/orders/public/:id */
type EcartPublicOrder = {
    status?: string;
    payments?: Array<{
        type?: string;
        method?: { reference?: string; merchants?: Array<{ key?: string }> };
    }>;
};

function mismatch(field: string, actual: unknown, expected: unknown): string | null {
    return actual === expected ? null : `${field} "${actual}" (debía ser "${expected}")`;
}

/** Revisa lo que quedó escrito en el formulario antes de pulsar "Procesar pago". Devuelve las diferencias. */
async function findFormProblems(page: Page, oxxoMethod: Locator): Promise<string[]> {
    const [firstName, lastName, email, phone, country, oxxoChecked] = await Promise.all([
        page.locator(SELECTORS.firstName).inputValue(),
        page.locator(SELECTORS.lastName).inputValue(),
        page.locator(SELECTORS.email).inputValue(),
        page.locator(SELECTORS.phone).inputValue(),
        page.locator(SELECTORS.countryDropdown).innerText(),
        oxxoMethod.locator(SELECTORS.paymentRadio).isChecked(),
    ]);
    return [
        mismatch('nombre', firstName, CUSTOMER.firstName),
        mismatch('apellido', lastName, CUSTOMER.lastName),
        mismatch('correo', email, CUSTOMER.email),
        mismatch('teléfono', phone.replace(/\D/g, ''), CUSTOMER.phone), // el campo lo muestra como "984 105 5603"
        mismatch('prefijo', country.match(/\+\d+/)?.[0], '+52'),
        mismatch('método OXXO marcado', oxxoChecked, true),
    ].filter((problem) => problem !== null);
}

/** Compara la orden que guardó Ecart Pay con lo que se pidió. Devuelve las diferencias. */
export function findOrderProblems(checkout: EcartCheckout, publicOrder: EcartPublicOrder, expected: { amount: number; reference: string }): string[] {
    const order = checkout.order;
    const payment = publicOrder.payments?.[0];
    return [
        mismatch('nombre', order?.first_name, CUSTOMER.firstName),
        mismatch('apellido', order?.last_name, CUSTOMER.lastName),
        mismatch('correo', order?.email?.toLowerCase(), CUSTOMER.email),
        mismatch('teléfono', order?.phone, `52${CUSTOMER.phone}`),
        mismatch('moneda', order?.currency, 'MXN'),
        mismatch('total', order?.totals?.total, expected.amount),
        mismatch('estado', publicOrder.status, 'pending'),
        mismatch('tipo de pago', payment?.type, 'cash'),
        mismatch('tienda', payment?.method?.merchants?.map((merchant) => merchant.key).join(','), 'oxxo'),
        mismatch('referencia', payment?.method?.reference, expected.reference),
    ].filter((problem) => problem !== null);
}

/** Consulta a Ecart Pay la orden recién creada y confirma que coincide con lo pedido y con el voucher en pantalla. */
async function verifyOrder(page: Page, amount: number, reference: string): Promise<void> {
    const orderId = new URL(page.url()).searchParams.get('order_id');
    if (!orderId) {
        throw new Error(`no se encontró el número de orden en ${page.url()}`);
    }
    const getJson = async (path: string) => {
        const response = await page.request.get(`${ECART_API}/${path}/${orderId}`);
        if (isCloudflareChallenge(response.headers())) {
            throw new CaptchaError(`Cloudflare pidió verificación al consultar ${path}`);
        }
        if (!response.ok()) {
            throw new Error(`Ecart Pay respondió ${response.status()} al consultar ${path}`);
        }
        return response.json();
    };
    const [checkout, publicOrder] = await Promise.all([getJson('checkout'), getJson('orders/public')]);
    const problems = findOrderProblems(checkout, publicOrder, { amount, reference });
    if (problems.length > 0) {
        throw new Error(`la orden ${orderId} en Ecart Pay no coincide con lo pedido: ${problems.join('; ')}`);
    }
}

/** Cloudflare marca así las respuestas en las que pide verificar que eres humano. */
function isCloudflareChallenge(headers: Record<string, string>): boolean {
    return headers['cf-mitigated'] === 'challenge';
}

/**
 * Espera a que aparezca `expected`. Si en su lugar aparece una ventana de captcha, lanza CaptchaError
 * de inmediato en vez de esperar a que se acabe el tiempo.
 */
async function waitUnlessCaptcha(page: Page, expected: Locator, timeout?: number): Promise<void> {
    const challenge = page.locator(CAPTCHA_CHALLENGE).filter({ visible: true });
    await expected.or(challenge).filter({ visible: true }).first().waitFor({ timeout });
    if ((await challenge.count()) > 0) {
        throw new CaptchaError('la página pidió resolver un captcha');
    }
}

/** Si la página está cerrada no hay nada que revisar. */
async function isCaptchaOnScreen(page: Page): Promise<boolean> {
    return page.locator(CAPTCHA_ANY).filter({ visible: true }).count().then((count) => count > 0, () => false);
}

function isBlocked(url: string): boolean {
    const { hostname } = new URL(url);
    return BLOCKED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
        || hostname.startsWith('server-side-tagging-'); // Google Tag Manager del lado del servidor
}

async function cacheStaticFile(response: Response): Promise<void> {
    const url = response.url();
    if (response.status() !== 200 || !STATIC_FILES.test(url) || staticCache.has(url)) {
        return;
    }
    try {
        const headers = { ...response.headers() };
        // El cuerpo llega ya descomprimido
        delete headers['content-encoding'];
        delete headers['content-length'];
        staticCache.set(url, { status: 200, headers, body: await response.body() });
    } catch {
        // La página se cerró antes de leer el archivo: se guardará en la próxima petición
    }
}

async function saveDebugScreenshot(page: Page, label: string): Promise<string | null> {
    try {
        await mkdir(DEBUG_DIR, { recursive: true });
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${label}.png`;
        const path = fileURLToPath(new URL(name, DEBUG_DIR));
        await page.screenshot({ path, fullPage: true });
        return path;
    } catch {
        return null;
    }
}

/**
 * Borra todas las capturas (.png) guardadas en `debug/`. Devuelve cuántas se borraron.
 * Si la carpeta aún no existe, no hay nada que borrar y devuelve 0.
 */
export async function cleanupDebugScreenshots(): Promise<number> {
    let names: string[];
    try {
        names = await readdir(DEBUG_DIR);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return 0;
        }
        throw err;
    }
    let deleted = 0;
    for (const name of names) {
        if (!name.endsWith('.png')) {
            continue; // solo capturas; nunca se toca otra cosa
        }
        try {
            await unlink(new URL(name, DEBUG_DIR));
            deleted++;
        } catch {
            // Si justo se estaba escribiendo o ya no está, se ignora
        }
    }
    return deleted;
}

/** Captura el voucher que está en pantalla: desde el precio hasta la fila "Orden" (sin "Pagar antes de"). */
export async function captureVoucher(page: Page): Promise<Buffer> {
    const voucher = page.locator(SELECTORS.voucher).filter({ visible: true }).first();
    // Recorte en coordenadas del documento, con margen para que el precio no salga cortado
    const clip = await voucher.evaluate((el, { priceSelector, labelSelector, orderLabel }) => {
        const price = el.querySelector(priceSelector);
        const label = [...el.querySelectorAll(labelSelector)].find((node) => node.textContent?.trim().startsWith(orderLabel));
        const value = label?.nextElementSibling; // el número de orden va justo después de su etiqueta
        if (!price || !label || !value) {
            throw new Error('no se encontró el precio o la fila "Orden" en el voucher');
        }
        const pad = 16;
        const box = el.getBoundingClientRect();
        // El margen se detiene donde empieza lo de al lado, para que no se asome
        // el título de arriba ni "Pagar antes de" de abajo
        const above = price.previousElementSibling?.getBoundingClientRect().bottom ?? -Infinity;
        const below = value.nextElementSibling?.getBoundingClientRect().top ?? Infinity;
        const top = Math.max(price.getBoundingClientRect().top - pad, above);
        const bottom = Math.min(Math.max(label.getBoundingClientRect().bottom, value.getBoundingClientRect().bottom) + pad, below);
        return {
            x: box.left + window.scrollX - pad,
            y: top + window.scrollY,
            width: box.width + pad * 2,
            height: bottom - top,
        };
    }, { priceSelector: SELECTORS.price, labelSelector: SELECTORS.detailLabel, orderLabel: ORDER_LABEL });
    // animations: 'disabled' adelanta el fade-in del voucher para que no salga semitransparente
    return page.screenshot({ clip, fullPage: true, animations: 'disabled' });
}

async function createVoucher(browser: Browser, link: string, amount: string, onStep?: (step: VoucherStep) => void): Promise<Voucher> {
    const chromeMajor = browser.version().split('.')[0];
    const context = await browser.newContext({
        // Sin esto Chromium se anuncia como "HeadlessChrome"
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`,
        locale: 'es-MX',
        timezoneId: 'America/Mexico_City',
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 2, // captura nítida para que el código de barras aguante la compresión de Telegram
    });
    await context.route('**/*', (route) => {
        const url = route.request().url();
        if (isBlocked(url)) {
            return route.abort();
        }
        const cached = staticCache.get(url);
        return cached ? route.fulfill(cached) : route.continue();
    });
    context.on('response', (response) => void cacheStaticFile(response));
    let challenged = false;
    context.on('response', (response) => {
        if (isCloudflareChallenge(response.headers())) {
            challenged = true;
        }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

    const timings: VoucherTimings = { queue: 0, load: 0, form: 0, process: 0, capture: 0 };
    let mark = performance.now();
    const lap = (phase: keyof VoucherTimings) => {
        const now = performance.now();
        timings[phase] = now - mark;
        mark = now;
    };

    // Si algo se queda colgado, cerrar el contexto hace fallar lo que esté esperando y la fila sigue avanzando
    let timedOut = false;
    const watchdog = setTimeout(() => {
        timedOut = true;
        void context.close().catch(() => {});
    }, VOUCHER_TIMEOUT_MS);

    let step = 'abrir el checkout';
    try {
        onStep?.('opening');
        const response = await page.goto(link, { waitUntil: 'commit' });
        if (response && isCloudflareChallenge(response.headers())) {
            throw new CaptchaError('Cloudflare pidió verificar que eres humano');
        }
        const form = page.locator(SELECTORS.firstName);
        await waitUnlessCaptcha(page, form.or(page.getByText(LINK_NOT_FOUND_TEXT)));
        if (!(await form.isVisible())) {
            throw new Error('el enlace de pago no existe o fue desactivado en Ecart Pay');
        }
        lap('load');

        step = 'llenar los datos';
        onStep?.('filling');
        await form.fill(CUSTOMER.firstName);
        await page.locator(SELECTORS.lastName).fill(CUSTOMER.lastName);
        await page.locator(SELECTORS.email).fill(CUSTOMER.email);
        // El país por defecto depende de la IP, así que México se elige siempre a mano
        await page.locator(SELECTORS.countryDropdown).click();
        await page.locator(SELECTORS.countryMexico).click();
        await page.locator(SELECTORS.phone).fill(CUSTOMER.phone);
        const oxxoMethod = page.locator(SELECTORS.paymentMethod)
            .filter({ has: page.getByText(OXXO_METHOD_NAME, { exact: true }) });
        await oxxoMethod.click();
        // Última revisión antes de crear la orden: si algo no quedó bien, se detiene sin crearla
        const formProblems = await findFormProblems(page, oxxoMethod);
        if (formProblems.length > 0) {
            throw new Error(`el formulario no quedó bien, no se creó la orden: ${formProblems.join('; ')}`);
        }
        lap('form');

        step = 'procesar el pago';
        onStep?.('processing');
        await page.getByRole('button', { name: 'Procesar pago' }).click();
        // La página trae una segunda copia oculta del voucher (para imprimir), por eso se filtra la visible
        const voucher = page.locator(SELECTORS.voucher).filter({ visible: true }).first();
        const reference = voucher.locator(SELECTORS.reference).filter({ hasText: /\d{10,}/ });
        await waitUnlessCaptcha(page, reference, 60_000);
        await voucher.locator(SELECTORS.barcode).waitFor();
        const referenceText = (await reference.innerText()).trim();
        onStep?.('verifying');
        await Promise.all([
            // decode() termina cuando la imagen ya está descargada y lista para pintarse (falla si no cargó)
            voucher.locator(SELECTORS.voucherImages).evaluateAll((images) =>
                Promise.all(images.map((img) => (img as HTMLImageElement).decode())),
            ),
            // La imagen solo se envía si la orden guardada en Ecart coincide con lo pedido y con la referencia en pantalla
            verifyOrder(page, Number(amount), referenceText),
        ]);
        lap('process');

        step = 'capturar el voucher';
        onStep?.('capturing');
        const image = await captureVoucher(page);
        lap('capture');

        return { image, reference: referenceText, timings };
    } catch (err) {
        // Solo se culpa al captcha si de verdad hubo uno: una ventana de captcha, Cloudflare pidiendo
        // verificación, o la página atorada con un captcha en pantalla
        const stuckOnCaptcha = err instanceof errors.TimeoutError && (await isCaptchaOnScreen(page));
        const captcha = err instanceof CaptchaError || challenged || stuckOnCaptcha;
        const debugFile = await saveDebugScreenshot(page, captcha ? `${amount}_captcha` : amount);
        let reason = timedOut ? `tardó más de ${VOUCHER_TIMEOUT_MS / 1000} s` : err instanceof Error ? err.message : String(err);
        if (captcha && !(err instanceof CaptchaError)) {
            reason = `captcha detectado. ${reason}`;
        }
        const message = `Falló al ${step}${debugFile ? ` (captura: ${debugFile})` : ''}: ${reason}`;
        throw captcha ? new CaptchaError(message, { cause: err }) : new Error(message, { cause: err });
    } finally {
        clearTimeout(watchdog);
        await context.close().catch(() => {});
    }
}

/** Abre Chromium una sola vez; cada petición solo crea un contexto nuevo que se cierra al terminar. */
export async function createVoucherGenerator(options: { headless: boolean }): Promise<VoucherGenerator> {
    const launch = () => chromium.launch({ headless: options.headless });
    const queue = new TaskQueue(MAX_CONCURRENT);
    let browser = await launch();
    let closed = false;

    return {
        get pending() {
            return queue.size;
        },

        generate(link, amount, onStep) {
            const queuedAt = performance.now();
            return queue.run(async () => {
                const queueTime = performance.now() - queuedAt;
                // Al apagar, lo que quedó en la fila no debe volver a abrir Chromium (dejaría el proceso vivo)
                if (closed) {
                    throw new Error('el bot se está apagando');
                }
                // Si Chromium se cerró o se cayó, se vuelve a abrir
                if (!browser.isConnected()) {
                    browser = await launch();
                }
                const voucher = await createVoucher(browser, link, amount, onStep);
                voucher.timings.queue = queueTime;
                return voucher;
            });
        },

        // Entra a la misma fila que generate(), así la limpieza no se cruza con un OXXO en proceso
        runExclusive(task) {
            return queue.run(task);
        },

        close() {
            closed = true;
            return browser.close();
        },
    };
}
