#!/bin/bash

# Shelby Pulse API Test Script
# Tests all endpoints and shows response status

API_URL="${1:-http://localhost:3001}"

echo "================================================"
echo "Testing Shelby Pulse API at: $API_URL"
echo "================================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_endpoint() {
  local name="$1"
  local endpoint="$2"

  echo -e "${YELLOW}Testing: $name${NC}"
  echo "  GET $endpoint"

  response=$(curl -s -w "\n%{http_code}" "$API_URL$endpoint")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    echo -e "  ${GREEN}✓ Status: $http_code${NC}"
    echo "  Response:"
    echo "$body" | jq -C . 2>/dev/null || echo "$body"
  else
    echo -e "  ${RED}✗ Status: $http_code${NC}"
    echo "  Response:"
    echo "$body"
  fi

  echo ""
}

# Test root endpoint
test_endpoint "API Root" "/"

# Test health check
test_endpoint "Health Check" "/api/health"

# Test network stats
test_endpoint "Network Stats" "/api/network/stats"

# Test recent blobs
test_endpoint "Recent Blobs" "/api/blobs/recent?limit=5"

# Test recent events
test_endpoint "Recent Events" "/api/events/recent?limit=10"

# Test providers
test_endpoint "Storage Providers" "/api/providers"

# Test economy endpoint (NEW)
test_endpoint "Economy Data" "/api/economy"

echo "================================================"
echo "Test complete!"
echo "================================================"
