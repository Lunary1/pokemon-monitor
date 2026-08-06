import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});

export { throttleDomain, resetThrottleState } from './throttle';
export { isErrorResult, detectTransition } from './transitions';
