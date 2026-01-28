/**
 * Payment processing activities
 *
 * These activities interact with payment gateways (Stripe, PayPal, etc.)
 * Demonstrates retry logic for transient failures
 */

import { v4 as uuidv4 } from 'uuid';
import type { ProcessPaymentInput, PaymentResult } from '../types';
import { PaymentError } from '../types';
import { logger } from '../utils/logger';

// Simulate payment database
const payments: Map<string, PaymentResult> = new Map();

// Simulate payment failure rate for testing retry logic
let paymentAttempts = 0;
const SIMULATED_FAILURE_RATE = 0.3; // 30% chance of transient failure

/**
 * Process payment for an order
 *
 * This activity demonstrates:
 * - Idempotency (same orderId = same payment result)
 * - Transient failure handling (Temporal will retry automatically)
 * - Permanent failure detection
 *
 * @throws PaymentError for permanent failures
 */
export async function processPayment(
  input: ProcessPaymentInput
): Promise<PaymentResult> {
  logger.info(`Processing payment for order ${input.orderId}`, {
    amount: input.amount,
    customerId: input.customerId,
  });

  // Check if payment already exists (idempotency)
  const existingPayment = Array.from(payments.values()).find(
    (p) => p.status === 'success' && input.orderId === input.orderId
  );

  if (existingPayment) {
    logger.info(`Payment already processed for order ${input.orderId}`);
    return existingPayment;
  }

  // Simulate API call delay
  await sleep(1000);

  paymentAttempts++;

  // Simulate transient failures (will be retried by Temporal)
  if (Math.random() < SIMULATED_FAILURE_RATE && paymentAttempts < 3) {
    logger.warn(`Transient payment failure (attempt ${paymentAttempts})`, {
      orderId: input.orderId,
    });
    throw new PaymentError('Payment gateway temporarily unavailable');
  }

  // Simulate permanent failure for specific test case
  if (input.amount > 10000 && input.paymentMethod.type === 'credit_card') {
    logger.error(`Payment declined for high-value transaction`, {
      amount: input.amount,
    });
    const failedPayment: PaymentResult = {
      paymentId: uuidv4(),
      status: 'failed',
      errorMessage: 'Payment declined - insufficient funds',
    };
    payments.set(failedPayment.paymentId, failedPayment);
    throw new PaymentError('Payment declined - insufficient funds');
  }

  // Successful payment
  const payment: PaymentResult = {
    paymentId: uuidv4(),
    status: 'success',
    transactionId: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };

  payments.set(payment.paymentId, payment);
  paymentAttempts = 0; // Reset counter on success

  logger.info(`Payment processed successfully`, {
    paymentId: payment.paymentId,
    transactionId: payment.transactionId,
  });

  return payment;
}

/**
 * Refund payment (compensation activity)
 * Called when order is cancelled after payment
 */
export async function refundPayment(paymentId: string): Promise<void> {
  logger.info(`Refunding payment ${paymentId}`);

  await sleep(800);

  const payment = payments.get(paymentId);
  if (!payment) {
    logger.warn(`Payment ${paymentId} not found, skipping refund`);
    return;
  }

  if (payment.status !== 'success') {
    logger.warn(`Payment ${paymentId} was not successful, skipping refund`);
    return;
  }

  // In real system, call payment gateway refund API
  logger.info(`Refund processed successfully`, {
    paymentId,
    transactionId: payment.transactionId,
  });

  // Mark payment as refunded
  payment.status = 'failed';
  payment.errorMessage = 'Refunded';
}

/**
 * Check payment status (for queries)
 */
export async function getPaymentStatus(paymentId: string): Promise<PaymentResult | null> {
  return payments.get(paymentId) || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
