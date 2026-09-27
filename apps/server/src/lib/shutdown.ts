import type { Logger } from '../config/logger';
import type { ErrorReporter } from './error-reporter';

const SHUTDOWN_TIMEOUT_MS = 25_000;

/** Arrêt propre sur SIGTERM/SIGINT, avec délai maximal pour ne jamais rester bloqué. */
export function onShutdown(logger: Logger, close: () => Promise<void>): void {
  let stopping = false;
  const handler = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'arrêt demandé');
    const timer = setTimeout(() => {
      logger.error('arrêt forcé : délai dépassé');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error }, "erreur pendant l'arrêt");
        process.exit(1);
      });
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
}

/**
 * Erreur non rattrapée (exception ou promesse rejetée) : journalisée, remontée, puis arrêt du
 * processus (état inconnu) ; l'orchestrateur le redémarre.
 */
export function exitOnFatalError(logger: Logger, reporter: ErrorReporter): void {
  const fatal = (error: unknown) => {
    logger.fatal({ err: error }, 'erreur non rattrapée');
    reporter.report(error);
    void reporter.flush().finally(() => process.exit(1));
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
}
