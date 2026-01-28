/**
 * Inventory management activities
 *
 * These activities interact with the inventory system to reserve and release stock.
 * In a real system, these would call inventory microservice APIs.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ReserveInventoryInput, InventoryReservation, OrderItem } from '../types';
import { InventoryError } from '../types';
import { logger } from '../utils/logger';

// Simulate inventory database
const inventoryDB: Map<string, number> = new Map([
  ['product-1', 100],
  ['product-2', 50],
  ['product-3', 200],
  ['product-4', 10],
  ['product-5', 0], // Out of stock
]);

const reservations: Map<string, InventoryReservation> = new Map();

/**
 * Reserve inventory for an order
 * This is a critical step that must be compensated if the order fails
 *
 * @throws InventoryError if items are out of stock
 */
export async function reserveInventory(
  input: ReserveInventoryInput
): Promise<InventoryReservation> {
  logger.info(`Reserving inventory for order ${input.orderId}`, {
    items: input.items,
  });

  // Simulate API call delay
  await sleep(500);

  // Check if all items are in stock
  for (const item of input.items) {
    const available = inventoryDB.get(item.productId) || 0;
    if (available < item.quantity) {
      logger.error(`Insufficient inventory for product ${item.productId}`, {
        requested: item.quantity,
        available,
      });
      throw new InventoryError(
        `Insufficient inventory for ${item.productName}. Requested: ${item.quantity}, Available: ${available}`
      );
    }
  }

  // Reserve items (reduce available stock)
  for (const item of input.items) {
    const current = inventoryDB.get(item.productId)!;
    inventoryDB.set(item.productId, current - item.quantity);
  }

  const reservation: InventoryReservation = {
    reservationId: uuidv4(),
    orderId: input.orderId,
    items: input.items,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
  };

  reservations.set(reservation.reservationId, reservation);

  logger.info(`Inventory reserved successfully`, { reservation });
  return reservation;
}

/**
 * Release inventory reservation (compensation activity)
 * This is called when the order workflow needs to rollback
 */
export async function releaseInventory(reservationId: string): Promise<void> {
  logger.info(`Releasing inventory reservation ${reservationId}`);

  await sleep(300);

  const reservation = reservations.get(reservationId);
  if (!reservation) {
    logger.warn(`Reservation ${reservationId} not found, skipping release`);
    return;
  }

  // Restore inventory
  for (const item of reservation.items) {
    const current = inventoryDB.get(item.productId) || 0;
    inventoryDB.set(item.productId, current + item.quantity);
  }

  reservations.delete(reservationId);
  logger.info(`Inventory released successfully`, { reservationId });
}

/**
 * Check current inventory levels (for testing)
 */
export async function checkInventory(productId: string): Promise<number> {
  return inventoryDB.get(productId) || 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
