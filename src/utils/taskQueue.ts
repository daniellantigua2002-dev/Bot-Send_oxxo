/**
 * Fila de tareas con límite de concurrencia (semáforo).
 * Las tareas arrancan en el mismo orden en que se llamó a run(): primero en llegar, primero en atenderse.
 */
export class TaskQueue {
    readonly #concurrency: number;
    #running = 0;
    readonly #waiting: Array<() => void> = [];

    constructor(concurrency: number) {
        this.#concurrency = concurrency;
    }

    /** Tareas en curso + en espera. */
    get size(): number {
        return this.#running + this.#waiting.length;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        // Esta parte es síncrona: el lugar en la fila se aparta en el momento exacto de la llamada
        if (this.#running < this.#concurrency) {
            this.#running++;
        } else {
            await new Promise<void>((resolve) => this.#waiting.push(resolve));
        }

        try {
            return await task();
        } finally {
            // El lugar pasa directo al siguiente en la fila; si no hay nadie, se libera
            const next = this.#waiting.shift();
            if (next) {
                next();
            } else {
                this.#running--;
            }
        }
    }
}
