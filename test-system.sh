#!/bin/bash

# System Integration Test Script
# Tests the complete Temporal e-commerce system

set -e

echo "=================================="
echo "Temporal E-commerce System Test"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="http://localhost:3001"

# Function to check if service is running
check_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=0

    echo -n "Waiting for $name to be ready..."
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
        echo -n "."
    done
    echo -e " ${RED}✗${NC}"
    echo "Failed to connect to $name at $url"
    return 1
}

# Test 1: Create a normal order
test_normal_order() {
    echo ""
    echo "Test 1: Creating normal order..."

    RESPONSE=$(curl -s -X POST "$API_URL/api/orders" \
        -H "Content-Type: application/json" \
        -d @examples/order1.json)

    ORDER_ID=$(echo "$RESPONSE" | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)

    if [ -z "$ORDER_ID" ]; then
        echo -e "${RED}✗ Failed to create order${NC}"
        echo "$RESPONSE"
        return 1
    fi

    echo -e "${GREEN}✓ Order created: $ORDER_ID${NC}"

    # Wait a bit for processing
    sleep 3

    # Check status
    echo "Checking order status..."
    STATUS_RESPONSE=$(curl -s "$API_URL/api/orders/$ORDER_ID")
    STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    echo -e "${GREEN}✓ Order status: $STATUS${NC}"
    echo "$STATUS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$STATUS_RESPONSE"
}

# Test 2: Create high-value order requiring approval
test_high_value_order() {
    echo ""
    echo "Test 2: Creating high-value order (requires approval)..."

    RESPONSE=$(curl -s -X POST "$API_URL/api/orders" \
        -H "Content-Type: application/json" \
        -d @examples/order-high-value.json)

    ORDER_ID=$(echo "$RESPONSE" | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)

    if [ -z "$ORDER_ID" ]; then
        echo -e "${RED}✗ Failed to create order${NC}"
        return 1
    fi

    echo -e "${GREEN}✓ High-value order created: $ORDER_ID${NC}"

    # Wait for workflow to reach approval state
    sleep 3

    # Check if waiting for approval
    STATUS_RESPONSE=$(curl -s "$API_URL/api/orders/$ORDER_ID")
    STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    if [ "$STATUS" = "awaiting_approval" ]; then
        echo -e "${YELLOW}⏳ Order awaiting approval${NC}"

        # Send approval
        echo "Sending approval..."
        APPROVAL_RESPONSE=$(curl -s -X POST "$API_URL/api/orders/$ORDER_ID/approve" \
            -H "Content-Type: application/json" \
            -d '{"approved": true, "approvedBy": "test-admin", "reason": "Automated test approval"}')

        echo -e "${GREEN}✓ Approval sent${NC}"

        # Wait for processing
        sleep 3

        # Check final status
        FINAL_STATUS=$(curl -s "$API_URL/api/orders/$ORDER_ID" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        echo -e "${GREEN}✓ Final status: $FINAL_STATUS${NC}"
    else
        echo -e "${YELLOW}⚠ Order status: $STATUS (expected awaiting_approval)${NC}"
    fi
}

# Main test execution
main() {
    echo "Checking services..."
    check_service "$API_URL/health" "API Server" || exit 1
    check_service "http://localhost:8233" "Temporal UI" || exit 1

    test_normal_order
    test_high_value_order

    echo ""
    echo "=================================="
    echo -e "${GREEN}All tests completed!${NC}"
    echo "=================================="
    echo ""
    echo "Next steps:"
    echo "1. View workflows in Temporal UI: http://localhost:8233"
    echo "2. Check the comprehensive logs in worker terminal"
    echo "3. Try more examples:"
    echo "   - Create order: curl -X POST $API_URL/api/orders -H 'Content-Type: application/json' -d @examples/order1.json"
    echo "   - Get status:   curl $API_URL/api/orders/order-001"
    echo "   - Approve:      curl -X POST $API_URL/api/orders/order-002-hv/approve -H 'Content-Type: application/json' -d '{\"approved\": true, \"approvedBy\": \"admin\"}'"
    echo ""
}

main
