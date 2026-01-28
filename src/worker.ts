/**
 * Temporal Worker
 *
 * Workers execute workflows and activities.
 * This worker handles THREE types of workflows:
 * - Order Processing (e-commerce with Saga pattern)
 * - ML Training (checkpoint recovery)
 * - Agent Tasks (autonomous codebase analysis with multi-agent coordination)
 *
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

    // Create worker for order processing
    const orderWorker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: 'order-processing',
      workflowsPath: require.resolve('./workflows'),
      activities,
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 10,
    });

    // Create worker for ML training
    const mlWorker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: 'ml-training',
      workflowsPath: require.resolve('./workflows'),
      activities,
      maxConcurrentActivityTaskExecutions: 5, // ML activities are more resource-intensive
      maxConcurrentWorkflowTaskExecutions: 5,
    });

    // Create worker for agent tasks (autonomous codebase analysis)
    const agentWorker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: 'agent-tasks',
      workflowsPath: require.resolve('./workflows'),
      activities,
      maxConcurrentActivityTaskExecutions: 8, // Agent activities are moderately intensive
      maxConcurrentWorkflowTaskExecutions: 8,
    });

    logger.info('Workers created successfully');
    logger.info('Task queues:');
    logger.info('  - order-processing (Saga pattern, e-commerce)');
    logger.info('  - ml-training (Checkpoint recovery, ML workflows)');
    logger.info('  - agent-tasks (Autonomous agents, multi-agent coordination)');
    logger.info('Starting workers...');

    // Run all three workers concurrently
    await Promise.all([
      orderWorker.run(),
      mlWorker.run(),
      agentWorker.run(),
    ]);
  } catch (error) {
    logger.error('Worker failed', { error });
    process.exit(1);
  }
}

run().catch((err) => {
  logger.error('Fatal error', { error: err });
  process.exit(1);
});
