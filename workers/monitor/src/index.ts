import { logger, recordErrorLog } from '@pokemon-monitor/core';
import { dispatch } from '@pokemon-monitor/notifications';
import cron from 'node-cron';
import { runCheckCycle } from './loop';

const TICK_SCHEDULE = '* * * * *'; // every minute; per-product cadence is DB-driven via Store.pollingInterval

let running = false;

cron.schedule(TICK_SCHEDULE, () => {
  if (running) {
    logger.warn('previous check cycle still running, skipping this tick');
    return;
  }

  running = true;
  runCheckCycle({
    // dispatch() reports its outcome to callers that want it; the loop hook
    // doesn't, so swallow the return value rather than widen the hook's type.
    onStockEvent: async (event) => {
      await dispatch(event);
    },
  })
    .catch(async (err) => {
      logger.error({ err }, 'check cycle failed');
      await recordErrorLog({
        source: 'worker',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? (err.stack ?? null) : null,
      });
    })
    .finally(() => {
      running = false;
    });
});

logger.info({ schedule: TICK_SCHEDULE }, 'monitor worker started');
