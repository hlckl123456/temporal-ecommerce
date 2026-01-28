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
import { mlTrainingWorkflow, researcherDecisionSignal, trainingStateQuery, type TrainingConfig, type ResearcherDecision } from '../workflows/ml-training-workflow';
import {
  codebaseAnalysisWorkflow,
  multiAgentCodebaseWorkflow,
  adaptiveAnalysisWorkflow,
  approveRefactorPlanSignal,
  approveBudgetSignal,
  analysisStateQuery,
  type CodebaseAnalysisTask,
  type ApprovalDecision as RefactorApprovalDecision,
  type BudgetApproval
} from '../workflows/agent-codebase-workflow';
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

// ==================== ML TRAINING ENDPOINTS ====================

/**
 * Start a new ML training job
 * Starts a new ML training workflow
 */
app.post('/api/ml-training', async (req, res) => {
  try {
    const config: TrainingConfig = req.body;

    // Validate input
    if (!config.modelId || !config.datasetId || !config.hyperparameters) {
      return res.status(400).json({
        error: 'Invalid training config',
        required: ['modelId', 'datasetId', 'hyperparameters'],
      });
    }

    logger.info(`Starting ML training`, { modelId: config.modelId, datasetId: config.datasetId });

    // Start workflow
    const handle = await temporalClient.workflow.start(mlTrainingWorkflow, {
      taskQueue: 'ml-training',
      workflowId: `ml-training-${config.modelId}-${Date.now()}`,
      args: [config],
    });

    logger.info(`ML training workflow started`, { workflowId: handle.workflowId, runId: handle.firstExecutionRunId });

    res.status(201).json({
      modelId: config.modelId,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      message: 'ML training started successfully',
      uiLink: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}/${handle.firstExecutionRunId}`,
    });
  } catch (error) {
    logger.error('Failed to start ML training', { error });
    res.status(500).json({
      error: 'Failed to start ML training',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get ML training status
 * Queries workflow state without modifying it
 */
app.get('/api/ml-training/:workflowId', async (req, res) => {
  try {
    const { workflowId } = req.params;

    const handle = temporalClient.workflow.getHandle(workflowId);

    // Query workflow state
    const state = await handle.query(trainingStateQuery);

    logger.info(`Retrieved training state`, { workflowId, status: state.status });

    res.json({
      ...state,
      workflowId,
      uiLink: `http://localhost:8233/namespaces/default/workflows/${workflowId}`,
    });
  } catch (error) {
    logger.error('Failed to get training status', { error, workflowId: req.params.workflowId });
    res.status(404).json({
      error: 'Training workflow not found or not running',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Send researcher decision
 * Allows researcher to continue, adjust, or stop training
 */
app.post('/api/ml-training/:workflowId/decision', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { action, reason, newHyperparameters } = req.body;

    if (!action || !['continue', 'adjust', 'stop'].includes(action)) {
      return res.status(400).json({
        error: 'Invalid input',
        required: ['action (continue|adjust|stop)'],
      });
    }

    const handle = temporalClient.workflow.getHandle(workflowId);

    const decision: ResearcherDecision = {
      action,
      reason,
      newHyperparameters,
    };

    await handle.signal(researcherDecisionSignal, decision);

    logger.info(`Researcher decision sent`, { workflowId, action });

    res.json({
      message: `Training ${action} decision sent`,
      decision,
    });
  } catch (error) {
    logger.error('Failed to send researcher decision', { error, workflowId: req.params.workflowId });
    res.status(500).json({
      error: 'Failed to send researcher decision',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ==================== AGENT CODEBASE ANALYSIS ENDPOINTS ====================

/**
 * Start agent codebase analysis
 * Demonstrates: Crash recovery, budget tracking, human-in-the-loop
 */
app.post('/api/agent/analyze', async (req, res) => {
  try {
    const task: CodebaseAnalysisTask = req.body;

    // Validate input
    if (!task.taskId || !task.repositoryPath || !task.files || task.files.length === 0) {
      return res.status(400).json({
        error: 'Invalid analysis task',
        required: ['taskId', 'repositoryPath', 'files'],
      });
    }

    logger.info(`Starting codebase analysis`, {
      taskId: task.taskId,
      files: task.files.length,
      budget: task.budget
    });

    // Start workflow
    const handle = await temporalClient.workflow.start(codebaseAnalysisWorkflow, {
      taskQueue: 'agent-tasks',
      workflowId: `agent-analysis-${task.taskId}`,
      args: [task],
    });

    logger.info(`Agent analysis workflow started`, {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId
    });

    res.status(201).json({
      taskId: task.taskId,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      message: 'Codebase analysis started',
      uiLink: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}/${handle.firstExecutionRunId}`,
    });
  } catch (error) {
    logger.error('Failed to start agent analysis', { error });
    res.status(500).json({
      error: 'Failed to start analysis',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get agent analysis status
 */
app.get('/api/agent/analyze/:workflowId', async (req, res) => {
  try {
    const { workflowId } = req.params;

    const handle = temporalClient.workflow.getHandle(workflowId);

    // Query workflow state
    const state = await handle.query(analysisStateQuery);

    logger.info(`Retrieved analysis state`, { workflowId, status: state.status });

    res.json({
      ...state,
      workflowId,
      uiLink: `http://localhost:8233/namespaces/default/workflows/${workflowId}`,
    });
  } catch (error) {
    logger.error('Failed to get analysis status', { error, workflowId: req.params.workflowId });
    res.status(404).json({
      error: 'Analysis workflow not found or not running',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Approve refactor plan
 */
app.post('/api/agent/analyze/:workflowId/approve-plan', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { approved, approvedBy, reason } = req.body;

    if (typeof approved !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid input',
        required: ['approved (boolean)'],
      });
    }

    const handle = temporalClient.workflow.getHandle(workflowId);

    const decision: RefactorApprovalDecision = {
      approved,
      approvedBy,
      reason,
    };

    await handle.signal(approveRefactorPlanSignal, decision);

    logger.info(`Refactor plan decision sent`, { workflowId, approved });

    res.json({
      message: approved ? 'Refactor plan approved' : 'Refactor plan rejected',
      decision,
    });
  } catch (error) {
    logger.error('Failed to send plan approval', { error, workflowId: req.params.workflowId });
    res.status(500).json({
      error: 'Failed to send plan approval',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Approve budget increase
 */
app.post('/api/agent/analyze/:workflowId/approve-budget', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { approved, newBudget, reason } = req.body;

    if (typeof approved !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid input',
        required: ['approved (boolean)'],
      });
    }

    const handle = temporalClient.workflow.getHandle(workflowId);

    const approval: BudgetApproval = {
      approved,
      newBudget,
      reason,
    };

    await handle.signal(approveBudgetSignal, approval);

    logger.info(`Budget approval sent`, { workflowId, approved, newBudget });

    res.json({
      message: approved ? 'Budget increase approved' : 'Budget increase rejected',
      approval,
    });
  } catch (error) {
    logger.error('Failed to send budget approval', { error, workflowId: req.params.workflowId });
    res.status(500).json({
      error: 'Failed to send budget approval',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Start multi-agent coordination workflow
 */
app.post('/api/agent/multi-agent', async (req, res) => {
  try {
    const { projectName, requirements } = req.body;

    if (!projectName || !requirements) {
      return res.status(400).json({
        error: 'Invalid input',
        required: ['projectName', 'requirements'],
      });
    }

    logger.info(`Starting multi-agent workflow`, { projectName });

    const handle = await temporalClient.workflow.start(multiAgentCodebaseWorkflow, {
      taskQueue: 'agent-tasks',
      workflowId: `multi-agent-${projectName}-${Date.now()}`,
      args: [{ projectName, requirements }],
    });

    res.status(201).json({
      projectName,
      workflowId: handle.workflowId,
      message: 'Multi-agent workflow started',
      uiLink: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}`,
    });
  } catch (error) {
    logger.error('Failed to start multi-agent workflow', { error });
    res.status(500).json({
      error: 'Failed to start multi-agent workflow',
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
      logger.info('');
      logger.info('Order Processing:');
      logger.info(`  Create order: curl -X POST http://localhost:${port}/api/orders -H "Content-Type: application/json" -d @examples/order1.json`);
      logger.info(`  Get status:   curl http://localhost:${port}/api/orders/order-001`);
      logger.info(`  Approve:      curl -X POST http://localhost:${port}/api/orders/order-001/approve -H "Content-Type: application/json" -d '{"approved": true, "approvedBy": "admin"}'`);
      logger.info('');
      logger.info('ML Training:');
      logger.info(`  Start training: curl -X POST http://localhost:${port}/api/ml-training -H "Content-Type: application/json" -d @examples/ml-training-config.json`);
      logger.info(`  Get progress:   curl http://localhost:${port}/api/ml-training/ml-training-<workflowId>`);
      logger.info(`  Continue:       curl -X POST http://localhost:${port}/api/ml-training/<workflowId>/decision -H "Content-Type: application/json" -d '{"action": "continue"}'`);
      logger.info('');
      logger.info('Agent Codebase Analysis:');
      logger.info(`  Start analysis: curl -X POST http://localhost:${port}/api/agent/analyze -H "Content-Type: application/json" -d @examples/codebase-analysis-config.json`);
      logger.info(`  Get progress:   curl http://localhost:${port}/api/agent/analyze/<workflowId>`);
      logger.info(`  Approve plan:   curl -X POST http://localhost:${port}/api/agent/analyze/<workflowId>/approve-plan -H "Content-Type: application/json" -d '{"approved": true, "approvedBy": "engineer"}'`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();
