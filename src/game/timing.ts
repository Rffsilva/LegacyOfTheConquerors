/** One unit of the original's query_timer() (util.cpp divides SDL ticks by 13.6). */
export const TIMER_UNIT_MS = 13.6;

/** Default game speed: screen::timer_wait = 6 timer units per frame ("moderate", ~12 ticks/s). */
export const TICK_MS = 6 * TIMER_UNIT_MS;

/** glad.cpp cycles the palette every 3 game ticks. */
export const PALETTE_CYCLE_MS = 3 * TICK_MS;
