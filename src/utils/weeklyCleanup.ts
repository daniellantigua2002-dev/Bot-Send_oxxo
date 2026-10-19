/**
 * Programación de una tarea semanal (cada domingo a una hora fija) sin dependencias externas.
 * Se usa para borrar las capturas de `debug/`, pero no sabe nada de ellas: solo llama a `run` y avisa.
 */

/** Nombres cortos que devuelve Intl, en orden: domingo = 0. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Milisegundos desde `now` hasta el próximo domingo a las `hour` en punto, en la zona `timeZone`.
 * Se calcula en "hora de pared": un cambio de horario de verano puede desviarlo como mucho una hora,
 * algo irrelevante para una limpieza semanal (y se recalcula después de cada ejecución).
 */
export function msUntilNextWeekly(now: Date, hour: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';

    const weekday = WEEKDAYS.indexOf(get('weekday') as (typeof WEEKDAYS)[number]); // domingo = 0
    let currentHour = Number(get('hour'));
    if (currentHour === 24) {
        currentHour = 0; // algunos entornos devuelven "24" a medianoche
    }
    const minute = Number(get('minute'));
    const second = Number(get('second'));

    const daysUntilSunday = (7 - weekday) % 7;
    let delay = ((daysUntilSunday * 24 + hour - currentHour) * 3600 - minute * 60 - second) * 1000 - now.getMilliseconds();
    if (delay <= 0) {
        delay += WEEK_MS; // la hora de hoy ya pasó: el domingo que viene
    }
    return delay;
}

export type WeeklyTask = {
    /** Detiene la programación (al apagar el bot). */
    stop(): void;
};

/**
 * Llama a `run` cada domingo a las `hour` en punto. Lo que `run` devuelve se le pasa a `onDone`.
 * Si `run` o `onDone` fallan, se avisa por `onError` y de todos modos se reprograma para el próximo domingo.
 */
export function scheduleWeeklyTask(options: {
    hour: number;
    timeZone: string;
    run: () => Promise<number>;
    onDone: (result: number) => void | Promise<void>;
    onError?: (err: unknown) => void;
}): WeeklyTask {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (): void => {
        const delay = msUntilNextWeekly(new Date(), options.hour, options.timeZone);
        timer = setTimeout(() => void tick(), delay);
    };

    const tick = async (): Promise<void> => {
        try {
            await options.onDone(await options.run());
        } catch (err) {
            options.onError?.(err);
        } finally {
            schedule();
        }
    };

    schedule();
    return { stop: () => clearTimeout(timer) };
}
