import { logger } from '@pokemon-monitor/core';
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
  runCheckCycle()
    .catch((err) => {
      logger.error({ err }, 'check cycle failed');
    })
    .finally(() => {
      running = false;
    });
});

logger.info({ schedule: TICK_SCHEDULE }, 'monitor worker started');
