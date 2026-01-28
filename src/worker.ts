/**
 * Temporal Worker
 *
 * Workers execute workflows and activities.
 * You can run multiple workers for:
 * - High availability
 * - Load distribution
 * - Different task queues
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { logger } from './utils/logger';

async function run() {
  try {
    // Connect to Temporal server
    const connection = await NativeConnection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });

    logger.info('Connected to Temporal server');

    // Create worker
    const worker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: 'order-processing',
      workflowsPath: require.resolve('./workflows/order-workflow'),
      activities,
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 10,
    });

    logger.info('Worker created successfully');
    logger.info('Task queue: order-processing');
    logger.info('Starting worker...');

    // Start worker
    await worker.run();
  } catch (error) {
    logger.error('Worker failed', { error });
    process.exit(1);
  }
}

run().catch((err) => {
  logger.error('Fatal error', { error: err });
  process.exit(1);
});
