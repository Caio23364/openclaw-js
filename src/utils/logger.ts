/**
 * OpenClaw - Logger Utility
 * Structured logging with multiple transports
 */

import pino from 'pino';
import { LoggingConfig } from '../types/index.js';

let logger: pino.Logger;

export function createLogger(config: LoggingConfig): pino.Logger {
  const transport: pino.TransportTargetOptions[] = [];

  if (config.output === 'console' || config.output === 'both') {
    if (config.format === 'pretty') {
      transport.push({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      });
    } else {
      transport.push({
        target: 'pino/file',
        options: { destination: 1 },
      });
    }
  }

  if ((config.output === 'file' || config.output === 'both') && config.filePath) {
    transport.push({
      target: 'pino/file',
      options: { destination: config.filePath },
    });
  }

  logger = pino({
    level: config.level,
    transport: transport.length > 0 ? { targets: transport } : undefined,
  });

  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    logger = pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    });
  }
  return logger;
}

export const log = {
  debug: (msg: string, obj?: any) => getLogger().debug(obj, msg),
  info: (msg: string, obj?: any) => getLogger().info(obj, msg),
  warn: (msg: string, obj?: any) => getLogger().warn(obj, msg),
  error: (msg: string, obj?: any) => getLogger().error(obj, msg),
  fatal: (msg: string, obj?: any) => getLogger().fatal(obj, msg),
};

export default log;
