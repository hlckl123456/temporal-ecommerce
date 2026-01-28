# Saga Pattern with Temporal

## What is the Saga Pattern?

The Saga pattern is a design pattern for managing distributed transactions across multiple services. Instead of a single ACID transaction, a saga is a sequence of local transactions where each transaction updates data within a single service.

## The Problem: Distributed Transactions

```
[Service A] ──┐
              ├─> [Transaction] ──> Success or Rollback?
[Service B] ──┤
              │
[Service C] ──┘
```

In a microservices architecture, you cannot use traditional database transactions because:
- Services have separate databases
- Network failures can occur between services
- Services may be temporarily unavailable
- Locking across services is not feasible

## Traditional Saga Implementation (Manual)

```typescript
async function processOrderTraditional(order) {
  let reservation, payment, shipment;
  let compensations = [];

  try {
    // Step 1: Reserve inventory
    reservation = await inventoryService.reserve(order);
    compensations.push(() => inventoryService.release(reservation.id));

    // Step 2: Process payment
    payment = await paymentService.charge(order);
    compensations.push(() => paymentService.refund(payment.id));

    // Step 3: Create shipment
    shipment = await shippingService.create(order);
    compensations.push(() => shippingService.cancel(shipment.id));

    return { success: true };
  } catch (error) {
    // Run compensations in reverse order
    for (const compensate of compensations.reverse()) {
      try {
        await compensate();
      } catch (compError) {
        // What do we do if compensation fails? 😰
        console.error('Compensation failed!', compError);
      }
    }
    throw error;
  }
}
```

**Problems with Manual Saga**:
1. ❌ **Boilerplate code** - track compensations manually
2. ❌ **Error-prone** - easy to forget to add compensation
3. ❌ **Compensation failures** - what if rollback fails?
4. ❌ **Process crashes** - lose track of what needs rollback
5. ❌ **No retries** - transient failures cause full rollback
6. ❌ **Testing complexity** - hard to test all scenarios

## Temporal Saga Implementation (Automatic)

```typescript
export async function orderWorkflow(order: OrderInput) {
  let reservationId, paymentId, shipmentId;

  try {
    // Forward transactions with automatic retries
    const reservation = await reserveInventory(order);
    reservationId = reservation.reservationId;

    const payment = await processPayment(order);
    paymentId = payment.paymentId;

    const shipment = await createShipment(order);
    shipmentId = shipment.shipmentId;

    return { success: true };
  } catch (error) {
    // Compensations run automatically in non-cancellable scope
    await CancellationScope.nonCancellable(async () => {
      if (shipmentId) await cancelShipment(shipmentId);
      if (paymentId) await refundPayment(paymentId);
      if (reservationId) await releaseInventory(reservationId);
    });
    throw error;
  }
}
```

**Benefits of Temporal Saga**:
1. ✅ **Automatic retries** - transient failures handled
2. ✅ **Guaranteed execution** - compensations always run
3. ✅ **Survives crashes** - durable execution
4. ✅ **Non-cancellable** - compensations complete even if workflow cancelled
5. ✅ **Easy to test** - deterministic replay
6. ✅ **Visible** - see every step in Temporal UI

## Saga Execution Flow

### Success Path

```
┌─────────────────────────────────────┐
│ Order Workflow                       │
├─────────────────────────────────────┤
│ 1. Reserve Inventory       ✅       │
│ 2. Process Payment         ✅       │
│ 3. Create Shipment         ✅       │
│ 4. Complete                ✅       │
└─────────────────────────────────────┘
```

### Failure with Compensation

```
┌─────────────────────────────────────┐
│ Order Workflow                       │
├─────────────────────────────────────┤
│ 1. Reserve Inventory       ✅       │
│ 2. Process Payment         ✅       │
│ 3. Create Shipment         ❌       │
│                                      │
│ === Compensation (Reverse) ===     │
│ 3. Cancel Shipment         N/A     │
│ 2. Refund Payment          ✅       │
│ 1. Release Inventory       ✅       │
│                                      │
│ Status: Failed (but consistent) ❌  │
└─────────────────────────────────────┘
```

## Key Principles

### 1. Forward Recovery First

Temporal automatically retries activities on transient failures:
```typescript
const activities = proxyActivities({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    maximumAttempts: 5,
    backoffCoefficient: 2,
  },
});
```

**Result**: Most "failures" are actually just transient issues that resolve on retry.

### 2. Compensations Run in Reverse Order

```typescript
try {
  const a = await stepA();  // First
  const b = await stepB();  // Second
  const c = await stepC();  // Third
} catch (error) {
  // Compensate in reverse: C → B → A
  await compensateC();
  await compensateB();
  await compensateA();
}
```

**Why reverse?** Later steps may depend on earlier steps:
- Can't release inventory before canceling shipment
- Can't refund payment before releasing inventory hold
- Maintains consistency at each stage

### 3. Compensations Must Be Idempotent

```typescript
export async function releaseInventory(reservationId: string): Promise<void> {
  const reservation = reservations.get(reservationId);

  // Idempotent: safe to call multiple times
  if (!reservation) {
    logger.warn('Reservation not found, already released');
    return; // ✅ Not an error
  }

  // Release inventory
  for (const item of reservation.items) {
    const current = inventory.get(item.productId) || 0;
    inventory.set(item.productId, current + item.quantity);
  }

  reservations.delete(reservationId);
}
```

**Why idempotent?** Temporal may retry compensations if they fail.

### 4. Use CancellationScope.nonCancellable

```typescript
catch (error) {
  // IMPORTANT: Use nonCancellable scope for compensations
  await CancellationScope.nonCancellable(async () => {
    // These MUST complete even if workflow is cancelled
    await cancelShipment(shipmentId);
    await refundPayment(paymentId);
    await releaseInventory(reservationId);
  });
  throw error;
}
```

**Why nonCancellable?** Ensures compensations complete even if:
- User cancels workflow
- Workflow times out
- System is shutting down

## Real-World Scenario

### E-commerce Order Processing

```typescript
export async function orderWorkflow(order: OrderInput): Promise<OrderState> {
  const state: OrderState = { status: 'pending' };
  let reservationId, paymentId, shipmentId;

  try {
    // === Forward Transactions ===

    // 1. Reserve Inventory
    const reservation = await reserveInventory(order);
    reservationId = reservation.reservationId;
    state.status = 'inventory_reserved';

    // 2. Process Payment (with retries for transient failures)
    const payment = await processPayment(order);
    paymentId = payment.paymentId;
    state.status = 'payment_completed';

    // 3. Await Approval (if high-value)
    if (order.totalAmount > 5000) {
      state.status = 'awaiting_approval';
      const approved = await condition(() => approvalReceived, '24h');
      if (!approved) throw new Error('Approval timeout');
    }

    // 4. Create Shipment
    const shipment = await createShipment(order);
    shipmentId = shipment.shipmentId;
    state.status = 'shipped';

    // 5. Auto-complete after delivery window
    await sleep('7 days');
    state.status = 'completed';

    return state;
  } catch (error) {
    // === Saga Compensation ===
    state.status = 'compensating';

    await CancellationScope.nonCancellable(async () => {
      // Compensate in reverse order
      if (shipmentId) {
        await cancelShipment(shipmentId).catch(logError);
      }
      if (paymentId) {
        await refundPayment(paymentId).catch(logError);
      }
      if (reservationId) {
        await releaseInventory(reservationId).catch(logError);
      }
    });

    state.status = 'failed';
    throw error;
  }
}
```

### What Happens in Edge Cases?

**Case 1: Payment Gateway Times Out**
```
1. Reserve Inventory      ✅
2. Process Payment        ⏱️ (timeout)
   → Temporal retries automatically (5 times)
   → If still failing, enters compensation
3. Release Inventory      ✅
Result: No double-charge, inventory released
```

**Case 2: Worker Crashes During Compensation**
```
1. Reserve Inventory      ✅
2. Process Payment        ✅
3. Create Shipment        ❌
   → Start compensation
   → Cancel Shipment      N/A
   → Refund Payment       ✅
   → 💥 Worker crashes
   → Worker restarts
   → Resume compensation
   → Release Inventory    ✅
Result: All compensations complete despite crash
```

**Case 3: Shipment Cancellation Fails**
```
1. Reserve Inventory      ✅
2. Process Payment        ✅
3. Create Shipment        ❌
   → Start compensation
   → Cancel Shipment      ❌ (carrier API down)
   → Refund Payment       ✅
   → Release Inventory    ✅
Result: Payment refunded, inventory released
        Manual intervention needed for shipment
```

## Best Practices

### 1. Design Activities to Be Idempotent

```typescript
// ✅ Good: Check if already processed
export async function processPayment(input: PaymentInput) {
  const existing = await db.getPaymentByOrderId(input.orderId);
  if (existing && existing.status === 'success') {
    return existing; // Already processed
  }
  // ... process payment
}

// ❌ Bad: No idempotency check
export async function processPayment(input: PaymentInput) {
  // Will charge twice if retried
  return await paymentGateway.charge(input);
}
```

### 2. Make Compensations Best-Effort

```typescript
// ✅ Good: Log but don't fail
await CancellationScope.nonCancellable(async () => {
  try {
    await cancelShipment(shipmentId);
  } catch (error) {
    logger.error('Shipment cancellation failed', { shipmentId, error });
    // Don't throw - continue with other compensations
  }

  try {
    await refundPayment(paymentId);
  } catch (error) {
    logger.error('Refund failed', { paymentId, error });
  }
});

// ❌ Bad: Throw on compensation failure
await cancelShipment(shipmentId); // Will stop other compensations if fails
```

### 3. Track Compensation State

```typescript
const state: OrderState = {
  // Track which steps completed
  inventoryReserved: false,
  paymentProcessed: false,
  shipmentCreated: false,
  // Track IDs for compensation
  reservationId: undefined,
  paymentId: undefined,
  shipmentId: undefined,
};

// Only compensate steps that completed
if (state.shipmentCreated && state.shipmentId) {
  await cancelShipment(state.shipmentId);
}
```

### 4. Use Timeouts Appropriately

```typescript
const activities = proxyActivities({
  startToCloseTimeout: '5 minutes',  // Total time for activity
  retry: {
    initialInterval: '1s',
    maximumInterval: '30s',
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['PaymentDeclinedError'], // Don't retry these
  },
});
```

## Comparison: Saga Patterns

| Feature | Manual Saga | Temporal Saga |
|---------|-------------|---------------|
| **Boilerplate** | High (track state manually) | Low (automatic) |
| **Retries** | Manual implementation | Automatic exponential backoff |
| **Crash Recovery** | Requires external coordinator | Built-in durable execution |
| **Compensation Guarantee** | No (can be lost) | Yes (non-cancellable scope) |
| **Visibility** | Custom logging | Temporal UI (every step) |
| **Testing** | Complex (need to mock crashes) | Simple (deterministic replay) |
| **Long-running** | Requires external state store | Built-in (workflows can run months) |

## Conclusion

Temporal's Saga implementation provides:

1. **Automatic retries** for transient failures
2. **Guaranteed compensation** execution
3. **Crash resilience** through durable execution
4. **Easy testing** with deterministic replay
5. **Complete visibility** in Temporal UI
6. **No boilerplate** for common patterns

**Result**: Write simple, readable code that handles complex distributed transaction scenarios reliably.
