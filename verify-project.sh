#!/bin/bash

# Project Verification Script
# Checks that all components are correctly set up

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=================================="
echo "Temporal E-commerce Project Verification"
echo "=================================="
echo ""

# Check 1: Dependencies installed
echo -n "Checking dependencies..."
if [ -d "node_modules" ]; then
    echo -e " ${GREEN}✓${NC}"
else
    echo -e " ${RED}✗${NC}"
    echo "Run 'pnpm install' to install dependencies"
    exit 1
fi

# Check 2: TypeScript compilation
echo -n "Checking TypeScript compilation..."
if pnpm build > /dev/null 2>&1; then
    echo -e " ${GREEN}✓${NC}"
else
    echo -e " ${RED}✗${NC}"
    echo "TypeScript compilation failed"
    exit 1
fi

# Check 3: Core files exist
echo "Checking core files..."

check_file() {
    if [ -f "$1" ]; then
        echo -e "  ${GREEN}✓${NC} $1"
    else
        echo -e "  ${RED}✗${NC} $1"
        exit 1
    fi
}

check_file "src/workflows/order-workflow.ts"
check_file "src/activities/inventory.ts"
check_file "src/activities/payment.ts"
check_file "src/activities/shipping.ts"
check_file "src/api/server.ts"
check_file "src/worker.ts"
check_file "src/types.ts"
check_file "docker-compose.yml"
check_file "package.json"
check_file "tsconfig.json"
check_file "README.md"
check_file "TESTING.md"
check_file "docs/SAGA_PATTERN.md"

# Check 4: Example files
echo "Checking example files..."
check_file "examples/order1.json"
check_file "examples/order-high-value.json"

# Check 5: Build output
echo "Checking build output..."
if [ -d "dist" ]; then
    echo -e "  ${GREEN}✓${NC} dist/ directory exists"
else
    echo -e "  ${RED}✗${NC} dist/ directory missing"
    exit 1
fi

# Check 6: Scripts are executable
echo "Checking scripts..."
if [ -x "test-system.sh" ]; then
    echo -e "  ${GREEN}✓${NC} test-system.sh is executable"
else
    echo -e "  ${YELLOW}⚠${NC} test-system.sh is not executable (run: chmod +x test-system.sh)"
fi

# Check 7: Count features
echo ""
echo "Project Statistics:"
echo "-------------------"

# Count lines of code
WORKFLOW_LINES=$(wc -l < src/workflows/order-workflow.ts)
ACTIVITY_LINES=$(find src/activities -name "*.ts" -exec wc -l {} + | tail -1 | awk '{print $1}')
API_LINES=$(wc -l < src/api/server.ts)
TOTAL_TS_LINES=$(find src -name "*.ts" -exec wc -l {} + | tail -1 | awk '{print $1}')

echo "  Workflow lines:  $WORKFLOW_LINES"
echo "  Activity lines:  $ACTIVITY_LINES"
echo "  API lines:       $API_LINES"
echo "  Total TS lines:  $TOTAL_TS_LINES"

# Count documentation
DOC_LINES=$(find docs -name "*.md" -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
README_LINES=$(wc -l < README.md)

echo ""
echo "  Documentation:"
echo "    README:      $README_LINES lines"
echo "    Docs folder: $DOC_LINES lines"

echo ""
echo "=================================="
echo -e "${GREEN}Project verification complete!${NC}"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Start Docker Desktop"
echo "2. Run: pnpm run docker:up"
echo "3. In another terminal: pnpm run worker"
echo "4. In another terminal: pnpm run api"
echo "5. Run: ./test-system.sh"
echo ""
echo "Or follow the complete guide in TESTING.md"
echo ""
