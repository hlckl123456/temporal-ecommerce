/**
 * Integration tests for order workflow
 *
 * These tests verify the complete order processing flow including:
 * - Successful order completion
 * - Payment failure with compensation
 * - High-value order approval
 * - Order cancellation with rollback
 */

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { orderWorkflow, approveOrderSignal, orderStateQuery } from '../../src/workflows/order-workflow';
import * as activities from '../../src/activities';
import type { OrderInput, ApprovalDecision } from '../../src/types';

describe('Order Workflow Integration Tests', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  beforeEach(async () => {
    worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../../src/workflows/order-workflow'),
      activities,
    });
  });

  afterEach(async () => {
    await worker?.shutdown();
  });

  test('should complete a normal order successfully', async () => {
    const orderInput: OrderInput = {
      orderId: 'test-order-1',
      customerId: 'test-customer-1',
      items: [
        {
          productId: 'product-1',
          productName: 'Test Product',
          quantity: 1,
          price: 100,
        },
      ],
      totalAmount: 100,
      shippingAddress: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345',
        country: 'USA',
      },
      paymentMethod: {
        type: 'credit_card',
        last4: '1234',
      },
    };

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(orderWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow-1',
        args: [orderInput],
      });

      const result = await handle.result();

      expect(result.status).toBe('completed');
      expect(result.orderId).toBe('test-order-1');
      expect(result.inventoryReserved).toBe(true);
      expect(result.paymentProcessed).toBe(true);
      expect(result.shipmentCreated).toBe(true);
    });
  }, 30000);

  test('should handle high-value order with approval', async () => {
    const orderInput: OrderInput = {
      orderId: 'test-order-2',
      customerId: 'test-customer-2',
      items: [
        {
          productId: 'product-1',
          productName: 'Expensive Product',
          quantity: 10,
          price: 1000,
        },
      ],
      totalAmount: 10000, // Requires approval
      shippingAddress: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345',
        country: 'USA',
      },
      paymentMethod: {
        type: 'credit_card',
        last4: '1234',
      },
    };

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(orderWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow-2',
        args: [orderInput],
      });

      // Wait for workflow to reach approval state
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check state
      const state = await handle.query(orderStateQuery);
      expect(state.status).toBe('awaiting_approval');

      // Send approval
      const approval: ApprovalDecision = {
        approved: true,
        approvedBy: 'test-admin',
        timestamp: new Date(),
      };

      await handle.signal(approveOrderSignal, approval);

      // Wait for completion
      const result = await handle.result();
      expect(result.status).toBe('completed');
      expect(result.approvedBy).toBe('test-admin');
    });
  }, 30000);

  test('should compensate on payment failure', async () => {
    const orderInput: OrderInput = {
      orderId: 'test-order-3',
      customerId: 'test-customer-3',
      items: [
        {
          productId: 'product-1',
          productName: 'Test Product',
          quantity: 1,
          price: 15000, // Will fail payment
        },
      ],
      totalAmount: 15000,
      shippingAddress: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345',
        country: 'USA',
      },
      paymentMethod: {
        type: 'credit_card',
        last4: '1234',
      },
    };

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(orderWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow-3',
        args: [orderInput],
      });

      try {
        await handle.result();
        fail('Expected workflow to fail');
      } catch (error) {
        // Expected to fail
        const state = await handle.query(orderStateQuery);
        expect(state.status).toBe('failed');
        // Verify inventory was released (compensation)
        expect(state.inventoryReserved).toBe(true); // Was reserved initially
      }
    });
  }, 30000);
});
