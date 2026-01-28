/**
 * Shipping and fulfillment activities
 *
 * These activities interact with shipping carriers (FedEx, UPS, etc.)
 */

import { v4 as uuidv4 } from 'uuid';
import type { CreateShipmentInput, ShipmentResult } from '../types';
import { ShipmentError } from '../types';
import { logger } from '../utils/logger';

// Simulate shipment database
const shipments: Map<string, ShipmentResult> = new Map();

const CARRIERS = ['FedEx', 'UPS', 'USPS', 'DHL'];

/**
 * Create shipment with carrier
 *
 * This activity demonstrates:
 * - External API integration
 * - Automatic retry on failures
 */
export async function createShipment(
  input: CreateShipmentInput
): Promise<ShipmentResult> {
  logger.info(`Creating shipment for order ${input.orderId}`, {
    customerId: input.customerId,
    address: input.shippingAddress,
  });

  // Simulate API call delay
  await sleep(700);

  // Simulate occasional carrier API failures
  if (Math.random() < 0.1) {
    logger.warn(`Carrier API temporarily unavailable`);
    throw new ShipmentError('Carrier API temporarily unavailable');
  }

  const carrier = CARRIERS[Math.floor(Math.random() * CARRIERS.length)];
  const trackingNumber = generateTrackingNumber(carrier);

  const shipment: ShipmentResult = {
    shipmentId: uuidv4(),
    trackingNumber,
    carrier,
    estimatedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
  };

  shipments.set(shipment.shipmentId, shipment);

  logger.info(`Shipment created successfully`, { shipment });
  return shipment;
}

/**
 * Cancel shipment (compensation activity)
 * Called when order is cancelled after shipment creation
 */
export async function cancelShipment(shipmentId: string): Promise<void> {
  logger.info(`Cancelling shipment ${shipmentId}`);

  await sleep(500);

  const shipment = shipments.get(shipmentId);
  if (!shipment) {
    logger.warn(`Shipment ${shipmentId} not found, may already be cancelled`);
    return;
  }

  // In real system, call carrier API to cancel pickup
  logger.info(`Shipment cancelled successfully`, { shipmentId });
  shipments.delete(shipmentId);
}

/**
 * Send notification to customer
 * Non-critical activity - failures are logged but don't fail the workflow
 */
export async function sendNotification(
  customerId: string,
  orderId: string,
  message: string,
  type: 'email' | 'sms' | 'push'
): Promise<void> {
  logger.info(`Sending ${type} notification to customer ${customerId}`, {
    orderId,
    message,
  });

  await sleep(200);

  // Simulate notification service
  logger.info(`Notification sent successfully`, {
    customerId,
    type,
  });
}

/**
 * Get shipment tracking info
 */
export async function getShipmentTracking(
  shipmentId: string
): Promise<ShipmentResult | null> {
  return shipments.get(shipmentId) || null;
}

function generateTrackingNumber(carrier: string): string {
  const prefix = carrier.substring(0, 3).toUpperCase();
  const random = Math.random().toString(36).substring(2, 15).toUpperCase();
  return `${prefix}${random}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
