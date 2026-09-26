import type { QueueDefinition } from '../src/jobs/queue';

/** Files créées uniquement dans la base de test. */
export const TEST_QUEUES: QueueDefinition[] = [{ name: 'test.outbox' }];
