/**
 * Order Processing Workflow with Saga Pattern
 *
 * This workflow demonstrates Temporal's core capabilities:
 * 1. Long-running workflows (can run for days/weeks)
 * 2. Saga pattern for distributed transactions
 * 3. Automatic retries with exponential backoff
 * 4. Human-in-the-loop (approval for high-value orders)
 * 5. Signals for external events (approval, cancellation)
 * 6. Queries for state inspection
 * 7. Timers for automatic actions
 * 8. Compensation logic on failures
 *
 * Workflow Steps:
 * 1. Reserve Inventory → if fail, end (no compensation needed)
 * 2. Process Payment → if fail, release inventory
 * 3. Await Approval (if order > $5000) → if rejected, refund & release inventory
 * 4. Create Shipment → if fail, refund & release inventory
 * 5. Auto-complete after 7 days → if no delivery confirmation
 *
 * This is a deterministic workflow - all non-deterministic operations
 * (API calls, random, Date.now()) must be done in Activities.
 */

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  sleep,
  CancellationScope,
  workflowInfo,
} from '@temporalio/workflow';
import type { OrderInput, OrderState, ApprovalDecision } from '../types';

// Import activity types
import type * as activities from '../activities';

// Create activity proxies with retry policies
const {
  reserveInventory,
  releaseInventory,
  processPayment,
  refundPayment,
  createShipment,
  cancelShipment,
  sendNotification,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
  },
});

// Separate proxy for notifications with non-retryable errors
const notifications = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 3,
  },
});

// Define signals (external events that can be sent to the workflow)
export const approveOrderSignal = defineSignal<[ApprovalDecision]>('approveOrder');
export const cancelOrderSignal = defineSignal('cancelOrder');

// Define queries (read-only access to workflow state)
export const orderStateQuery = defineQuery<OrderState>('orderState');

/**
 * Main order processing workflow
 */
export async function orderWorkflow(orderInput: OrderInput): Promise<OrderState> {
  // Initialize order state
  const state: OrderState = {
    orderId: orderInput.orderId,
    customerId: orderInput.customerId,
    totalAmount: orderInput.totalAmount,
    status: 'pending',
    inventoryReserved: false,
    paymentProcessed: false,
    shipmentCreated: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Variables for compensation
  let reservationId: string | undefined;
  let paymentId: string | undefined;
  let shipmentId: string | undefined;
  let isCancelled = false;
  let approvalDecision: ApprovalDecision | undefined;

  // Setup signal handlers
  setHandler(approveOrderSignal, (decision: ApprovalDecision) => {
    approvalDecision = decision;
  });

  setHandler(cancelOrderSignal, () => {
    isCancelled = true;
  });

  // Setup query handler (allows external inspection of state)
  setHandler(orderStateQuery, () => state);

  try {
    // === STEP 1: Reserve Inventory ===
    state.status = 'pending';
    state.updatedAt = new Date();

    const reservation = await reserveInventory({
      orderId: orderInput.orderId,
      items: orderInput.items,
    });

    reservationId = reservation.reservationId;
    state.inventoryReserved = true;
    state.reservationId = reservationId;
    state.status = 'inventory_reserved';
    state.updatedAt = new Date();

    // Notify customer
    await notifications.sendNotification(
      orderInput.customerId,
      orderInput.orderId,
      'Your order has been received and inventory is reserved!',
      'email'
    ).catch(() => {
      // Ignore notification failures
    });

    // Check for cancellation
    if (isCancelled) {
      throw new Error('Order cancelled by customer');
    }

    // === STEP 2: Process Payment ===
    state.status = 'payment_processing';
    state.updatedAt = new Date();

    const payment = await processPayment({
      orderId: orderInput.orderId,
      customerId: orderInput.customerId,
      amount: orderInput.totalAmount,
      paymentMethod: orderInput.paymentMethod,
    });

    paymentId = payment.paymentId;
    state.paymentProcessed = true;
    state.paymentId = paymentId;
    state.status = 'payment_completed';
    state.updatedAt = new Date();

    // Notify customer
    await notifications.sendNotification(
      orderInput.customerId,
      orderInput.orderId,
      `Payment of $${orderInput.totalAmount} processed successfully!`,
      'email'
    ).catch(() => {
      // Ignore notification failures
    });

    // Check for cancellation
    if (isCancelled) {
      throw new Error('Order cancelled by customer');
    }

    // === STEP 3: Approval for High-Value Orders ===
    const requiresApproval = orderInput.totalAmount > 5000;

    if (requiresApproval) {
      state.status = 'awaiting_approval';
      state.updatedAt = new Date();

      // Notify admin
      await notifications.sendNotification(
        'admin',
        orderInput.orderId,
        `High-value order $${orderInput.totalAmount} requires approval`,
        'email'
      ).catch(() => {
        // Ignore notification failures
      });

      // Wait for approval signal (with 24-hour timeout)
      const approved = await condition(() => approvalDecision !== undefined, '24h');

      if (!approved || !approvalDecision?.approved) {
        state.status = 'rejected';
        state.rejectedReason = approvalDecision?.reason || 'Approval timeout';
        state.updatedAt = new Date();
        throw new Error(
          `Order rejected: ${approvalDecision?.reason || 'Approval timeout'}`
        );
      }

      state.approvedBy = approvalDecision.approvedBy;
      state.status = 'approved';
      state.updatedAt = new Date();
    }

    // Check for cancellation
    if (isCancelled) {
      throw new Error('Order cancelled by customer');
    }

    // === STEP 4: Create Shipment ===
    state.status = 'shipment_created';
    state.updatedAt = new Date();

    const shipment = await createShipment({
      orderId: orderInput.orderId,
      customerId: orderInput.customerId,
      items: orderInput.items,
      shippingAddress: orderInput.shippingAddress,
    });

    shipmentId = shipment.shipmentId;
    state.shipmentCreated = true;
    state.shipmentId = shipmentId;
    state.trackingNumber = shipment.trackingNumber;
    state.status = 'shipped';
    state.updatedAt = new Date();

    // Notify customer
    await notifications.sendNotification(
      orderInput.customerId,
      orderInput.orderId,
      `Your order has shipped! Track: ${shipment.trackingNumber}`,
      'email'
    ).catch(() => {
      // Ignore notification failures
    });

    // === STEP 5: Auto-Complete After 7 Days ===
    // In production, you'd wait for delivery confirmation signal
    // Here we auto-complete after 7 days
    await sleep('7 days');

    state.status = 'completed';
    state.updatedAt = new Date();

    // Send completion notification
    await notifications.sendNotification(
      orderInput.customerId,
      orderInput.orderId,
      'Your order has been completed. Thank you!',
      'email'
    ).catch(() => {
      // Ignore notification failures
    });

    return state;
  } catch (error) {
    // === COMPENSATION LOGIC (Saga Pattern) ===
    state.status = 'compensating';
    state.updatedAt = new Date();

    // Run compensations in reverse order
    // Use CancellationScope to ensure compensations complete even if workflow is cancelled
    await CancellationScope.nonCancellable(async () => {
      // Compensate shipment
      if (shipmentId) {
        try {
          await cancelShipment(shipmentId);
        } catch (e) {
          // Log but don't fail compensation
          console.error('Failed to cancel shipment:', e);
        }
      }

      // Compensate payment
      if (paymentId) {
        try {
          await refundPayment(paymentId);
        } catch (e) {
          console.error('Failed to refund payment:', e);
        }
      }

      // Compensate inventory
      if (reservationId) {
        try {
          await releaseInventory(reservationId);
        } catch (e) {
          console.error('Failed to release inventory:', e);
        }
      }
    });

    state.status = 'failed';
    state.updatedAt = new Date();

    // Notify customer of failure
    await notifications.sendNotification(
      orderInput.customerId,
      orderInput.orderId,
      `Your order has been cancelled. Reason: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'email'
    ).catch(() => {
      // Ignore notification failures
    });

    throw error; // Re-throw to mark workflow as failed
  }
}
