/**
 * Core domain types for the e-commerce order processing system
 */

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface OrderInput {
  orderId: string;
  customerId: string;
  items: OrderItem[];
  totalAmount: number;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  paymentMethod: {
    type: 'credit_card' | 'debit_card' | 'paypal';
    last4?: string;
  };
}

export interface OrderState {
  orderId: string;
  status: OrderStatus;
  inventoryReserved: boolean;
  paymentProcessed: boolean;
  shipmentCreated: boolean;
  customerId: string;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
  reservationId?: string;
  paymentId?: string;
  shipmentId?: string;
  trackingNumber?: string;
  approvedBy?: string;
  rejectedReason?: string;
}

export type OrderStatus =
  | 'pending'
  | 'inventory_reserved'
  | 'payment_processing'
  | 'payment_completed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'shipment_created'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'compensating';

export interface InventoryReservation {
  reservationId: string;
  orderId: string;
  items: OrderItem[];
  expiresAt: Date;
}

export interface PaymentResult {
  paymentId: string;
  status: 'success' | 'failed' | 'pending';
  transactionId?: string;
  errorMessage?: string;
}

export interface ShipmentResult {
  shipmentId: string;
  trackingNumber: string;
  carrier: string;
  estimatedDeliveryDate: Date;
}

export interface ApprovalDecision {
  approved: boolean;
  approvedBy: string;
  reason?: string;
  timestamp: Date;
}

// Activity input/output types
export interface ReserveInventoryInput {
  orderId: string;
  items: OrderItem[];
}

export interface ProcessPaymentInput {
  orderId: string;
  customerId: string;
  amount: number;
  paymentMethod: OrderInput['paymentMethod'];
}

export interface CreateShipmentInput {
  orderId: string;
  customerId: string;
  items: OrderItem[];
  shippingAddress: OrderInput['shippingAddress'];
}

// Error types
export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

export class ShipmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShipmentError';
  }
}
