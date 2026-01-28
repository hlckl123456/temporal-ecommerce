/**
 * Express API Server
 *
 * Provides REST API to:
 * 1. Create orders (starts workflow)
 * 2. Query order status
 * 3. Approve/reject orders
 * 4. Cancel orders
 */

import express from 'express';
import cors from 'cors';
import { Connection, Client } from '@temporalio/client';
import { orderWorkflow, approveOrderSignal, cancelOrderSignal, orderStateQuery } from '../workflows/order-workflow';
import type { OrderInput, ApprovalDecision } from '../types';
import { logger } from '../utils/logger';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let temporalClient: Client;

// Initialize Temporal client
async function initTemporal() {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  temporalClient = new Client({
    connection,
    namespace: 'default',
  });

  logger.info('Connected to Temporal server');
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Create a new order
 * Starts a new workflow execution
 */
app.post('/api/orders', async (req, res) => {
  try {
    const orderInput: OrderInput = req.body;

    // Validate input
    if (!orderInput.orderId || !orderInput.customerId || !orderInput.items || orderInput.items.length === 0) {
      return res.status(400).json({
        error: 'Invalid order input',
        required: ['orderId', 'customerId', 'items'],
      });
    }

    logger.info(`Creating order ${orderInput.orderId}`, { customerId: orderInput.customerId });

    // Start workflow
    const handle = await temporalClient.workflow.start(orderWorkflow, {
      taskQueue: 'order-processing',
      workflowId: `order-${orderInput.orderId}`,
      args: [orderInput],
    });

    logger.info(`Workflow started`, { workflowId: handle.workflowId, runId: handle.firstExecutionRunId });

    res.status(201).json({
      orderId: orderInput.orderId,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      message: 'Order created successfully',
      uiLink: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}/${handle.firstExecutionRunId}`,
    });
  } catch (error) {
    logger.error('Failed to create order', { error });
    res.status(500).json({
      error: 'Failed to create order',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get order status
 * Queries workflow state without modifying it
 */
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const workflowId = `order-${orderId}`;

    const handle = temporalClient.workflow.getHandle(workflowId);

    // Query workflow state
    const state = await handle.query(orderStateQuery);

    logger.info(`Retrieved order state`, { orderId, status: state.status });

    res.json({
      ...state,
      workflowId,
      uiLink: `http://localhost:8233/namespaces/default/workflows/${workflowId}`,
    });
  } catch (error) {
    logger.error('Failed to get order status', { error, orderId: req.params.orderId });
    res.status(404).json({
      error: 'Order not found or workflow not running',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Approve or reject an order
 * Sends approval signal to workflow
 */
app.post('/api/orders/:orderId/approve', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { approved, approvedBy, reason } = req.body;

    if (typeof approved !== 'boolean' || !approvedBy) {
      return res.status(400).json({
        error: 'Invalid input',
        required: ['approved (boolean)', 'approvedBy (string)'],
      });
    }

    const workflowId = `order-${orderId}`;
    const handle = temporalClient.workflow.getHandle(workflowId);

    const decision: ApprovalDecision = {
      approved,
      approvedBy,
      reason,
      timestamp: new Date(),
    };

    await handle.signal(approveOrderSignal, decision);

    logger.info(`Approval decision sent`, { orderId, approved, approvedBy });

    res.json({
      message: approved ? 'Order approved' : 'Order rejected',
      decision,
    });
  } catch (error) {
    logger.error('Failed to send approval', { error, orderId: req.params.orderId });
    res.status(500).json({
      error: 'Failed to send approval decision',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Cancel an order
 * Sends cancellation signal to workflow
 */
app.post('/api/orders/:orderId/cancel', async (req, res) => {
  try {
    const { orderId } = req.params;
    const workflowId = `order-${orderId}`;

    const handle = temporalClient.workflow.getHandle(workflowId);
    await handle.signal(cancelOrderSignal);

    logger.info(`Cancellation signal sent`, { orderId });

    res.json({
      message: 'Order cancellation requested',
      orderId,
    });
  } catch (error) {
    logger.error('Failed to cancel order', { error, orderId: req.params.orderId });
    res.status(500).json({
      error: 'Failed to cancel order',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * List all workflows (for admin dashboard)
 */
app.get('/api/orders', async (req, res) => {
  try {
    // This is a simplified version - in production you'd want pagination
    // and would query from a database that's updated by workflow events

    res.json({
      message: 'Use Temporal UI to view all workflows: http://localhost:8233',
      endpoints: {
        'Create order': 'POST /api/orders',
        'Get order': 'GET /api/orders/:orderId',
        'Approve order': 'POST /api/orders/:orderId/approve',
        'Cancel order': 'POST /api/orders/:orderId/cancel',
      },
    });
  } catch (error) {
    logger.error('Failed to list orders', { error });
    res.status(500).json({
      error: 'Failed to list orders',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start server
async function start() {
  try {
    await initTemporal();

    app.listen(port, () => {
      logger.info(`API Server running on http://localhost:${port}`);
      logger.info('Temporal UI: http://localhost:8233');
      logger.info('');
      logger.info('Example API calls:');
      logger.info(`  Create order: curl -X POST http://localhost:${port}/api/orders -H "Content-Type: application/json" -d @examples/order1.json`);
      logger.info(`  Get status:   curl http://localhost:${port}/api/orders/order-123`);
      logger.info(`  Approve:      curl -X POST http://localhost:${port}/api/orders/order-123/approve -H "Content-Type: application/json" -d '{"approved": true, "approvedBy": "admin"}'`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();
