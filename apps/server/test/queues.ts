import { QUEUES, type QueueDefinition } from '../src/jobs/queue';

/** Files de l'application, plus celles créées uniquement dans la base de test. */
export const TEST_QUEUES: QueueDefinition[] = [...QUEUES, { name: 'test.outbox' }];
