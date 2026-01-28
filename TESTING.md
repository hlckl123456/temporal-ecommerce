# Testing Guide

## Prerequisites

Before running the system, ensure you have:

1. **Docker Desktop** installed and running
2. **Node.js 18+** installed
3. **pnpm** installed (`npm install -g pnpm`)

## Quick Start Testing

### 1. Start Docker Desktop

Make sure Docker is running on your machine.

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build the Project

```bash
pnpm build
```

### 4. Start Temporal Server

```bash
pnpm run docker:up
```

Wait about 30 seconds for Temporal to fully initialize. You can verify it's running by opening:
- Temporal UI: http://localhost:8233

### 5. Start the Worker (Terminal 1)

```bash
pnpm run worker
```

You should see:
```
Worker created successfully
Task queue: order-processing
Starting worker...
```

### 6. Start the API Server (Terminal 2)

```bash
pnpm run api
```

You should see:
```
Connected to Temporal server
API Server running on http://localhost:3001
Temporal UI: http://localhost:8233
```

### 7. Run System Test (Terminal 3)

```bash
chmod +x test-system.sh
./test-system.sh
```

This will:
1. Create a normal order
2. Create a high-value order that requires approval
3. Automatically approve it
4. Show you the results

## Manual Testing

### Test 1: Create a Normal Order

```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d @examples/order1.json
```

**Expected Response**:
```json
{
  "orderId": "order-001",
  "workflowId": "order-order-001",
  "runId": "...",
  "message": "Order created successfully",
  "uiLink": "http://localhost:8233/..."
}
```

### Test 2: Check Order Status

```bash
curl http://localhost:3001/api/orders/order-001 | jq
```

**Expected Response**:
```json
{
  "orderId": "order-001",
  "status": "shipped",
  "inventoryReserved": true,
  "paymentProcessed": true,
  "shipmentCreated": true,
  "reservationId": "...",
  "paymentId": "...",
  "shipmentId": "...",
  "trackingNumber": "FED..."
}
```

### Test 3: High-Value Order with Approval

```bash
# Create high-value order
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d @examples/order-high-value.json

# Check status (should be awaiting_approval)
curl http://localhost:3001/api/orders/order-002-hv | jq .status

# Approve the order
curl -X POST http://localhost:3001/api/orders/order-002-hv/approve \
  -H "Content-Type: application/json" \
  -d '{
    "approved": true,
    "approvedBy": "admin@company.com",
    "reason": "Verified with customer"
  }'

# Check status again (should be shipped)
curl http://localhost:3001/api/orders/order-002-hv | jq .status
```

### Test 4: Order Cancellation (Saga Compensation)

```bash
# Create order
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "order-cancel-test",
    "customerId": "customer-999",
    "items": [{"productId": "product-1", "productName": "Test", "quantity": 1, "price": 100}],
    "totalAmount": 100,
    "shippingAddress": {"street": "123 Test", "city": "Test", "state": "TS", "zipCode": "12345", "country": "USA"},
    "paymentMethod": {"type": "credit_card", "last4": "1234"}
  }'

# Cancel immediately (within a few seconds)
curl -X POST http://localhost:3001/api/orders/order-cancel-test/cancel

# Check status - should see compensation
curl http://localhost:3001/api/orders/order-cancel-test | jq
```

## Viewing Workflows in Temporal UI

Open http://localhost:8233 and you'll see:

1. **Workflows** tab - All running and completed workflows
2. **Click any workflow** to see:
   - Complete execution history
   - Every activity execution
   - Retry attempts
   - Pending signals/timers
   - Input/output payloads
   - Stack traces

## Troubleshooting

### Docker not running
```
Error: Couldn't connect to Docker daemon
```
**Solution**: Start Docker Desktop

### Port already in use
```
Error: Port 7233 is already allocated
```
**Solution**: Stop existing Temporal server
```bash
pnpm run docker:down
pnpm run docker:up
```

### Worker not connecting
```
Error: Failed to connect to Temporal server
```
**Solution**: Wait longer for Temporal to start (30-60 seconds), then restart worker

### Activity timeout
Activities are configured with 5-minute timeouts. If you see timeout errors, check:
1. External services are reachable
2. No infinite loops in activities
3. Timeout configuration is appropriate

## Running Tests

### Unit Tests
```bash
pnpm test
```

### Integration Tests
```bash
pnpm run test:integration
```

This uses Temporal's test environment (no Docker required for tests).

## Performance Testing

### Create 100 Orders Concurrently

```bash
for i in {1..100}; do
  curl -X POST http://localhost:3001/api/orders \
    -H "Content-Type: application/json" \
    -d '{
      "orderId": "perf-test-'$i'",
      "customerId": "customer-'$i'",
      "items": [{"productId": "product-1", "productName": "Test", "quantity": 1, "price": 100}],
      "totalAmount": 100,
      "shippingAddress": {"street": "123 Test", "city": "Test", "state": "TS", "zipCode": "12345", "country": "USA"},
      "paymentMethod": {"type": "credit_card", "last4": "1234"}
    }' &
done
wait
```

Then check Temporal UI to see all 100 workflows running concurrently!

## Cleanup

```bash
# Stop all services
pnpm run docker:down

# Remove volumes (reset data)
docker-compose down -v
```

## Next Steps

1. Read [docs/SAGA_PATTERN.md](./docs/SAGA_PATTERN.md) to understand compensation logic
2. Modify workflows in `src/workflows/order-workflow.ts`
3. Add new activities in `src/activities/`
4. Experiment with different failure scenarios
5. Try adding new signals and queries

## Common Test Scenarios

### Test Automatic Retries

Modify `src/activities/payment.ts` to increase `SIMULATED_FAILURE_RATE` to 0.8 (80% failure). Then create an order and watch Temporal automatically retry the payment activity.

### Test Long-Running Workflows

Modify the `sleep('7 days')` in the workflow to `sleep('10 seconds')` for faster testing.

### Test Compensation

Create an order with `totalAmount: 15000` - this will cause payment failure and trigger the full Saga compensation chain.

## Support

If you encounter issues:
1. Check Docker Desktop is running
2. Check ports 7233, 8233, 3001, 5432 are available
3. Check worker and API logs for errors
4. View workflow execution in Temporal UI
5. Open an issue with logs and steps to reproduce
