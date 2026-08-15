#!/bin/bash

# ShelbyUSD metadata address
METADATA="0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1"
API_URL="https://api.shelbynet.shelby.xyz/v1/graphql"

echo "=== DEBUGGING SHELBYUSD DATA ON SHELBYNET ==="
echo ""

# 1. Check total number of current balances
echo "1. Total ShelbyUSD balance holders:"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r '.data.current_fungible_asset_balances | length'
{
  "query": "query { current_fungible_asset_balances(where: {asset_type: {_eq: \"$METADATA\"}}, order_by: {amount: desc}, limit: 10000) { owner_address amount } }"
}
EOF

echo ""

# 2. Get top 20 holders
echo "2. Top 20 ShelbyUSD holders:"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r '.data.current_fungible_asset_balances[] | "\(.owner_address | .[0:10])...\(.owner_address | .[-6:]) = \(.amount)"'
{
  "query": "query { current_fungible_asset_balances(where: {asset_type: {_eq: \"$METADATA\"}}, order_by: {amount: desc}, limit: 20) { owner_address amount } }"
}
EOF

echo ""

# 3. Calculate total supply
echo "3. Total ShelbyUSD supply (sum of all balances):"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r '.data.current_fungible_asset_balances | map(.amount | tonumber) | add'
{
  "query": "query { current_fungible_asset_balances(where: {asset_type: {_eq: \"$METADATA\"}}, limit: 10000) { amount } }"
}
EOF

echo ""

# 4. Check total activity count
echo "4. Total ShelbyUSD activities (all time):"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r '.data.fungible_asset_activities | length'
{
  "query": "query { fungible_asset_activities(where: {asset_type: {_eq: \"$METADATA\"}}, limit: 100000) { transaction_version } }"
}
EOF

echo ""

# 5. Get activity breakdown by type
echo "5. Activity breakdown by type:"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r 'group_by(.type) | map({type: .[0].type, count: length}) | .[]' << INNER
$(curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << OUTER | jq -r '.data.fungible_asset_activities'
{
  "query": "query { fungible_asset_activities(where: {asset_type: {_eq: \"$METADATA\"}}, limit: 100000) { type } }"
}
OUTER
)
INNER
EOF

echo ""

# 6. Get earliest and latest transactions
echo "6. Transaction version range:"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r '"Earliest: " + (.data.earliest[0].transaction_version // "N/A") + "\nLatest: " + (.data.latest[0].transaction_version // "N/A")'
{
  "query": "query { earliest: fungible_asset_activities(where: {asset_type: {_eq: \"$METADATA\"}}, order_by: {transaction_version: asc}, limit: 1) { transaction_version } latest: fungible_asset_activities(where: {asset_type: {_eq: \"$METADATA\"}}, order_by: {transaction_version: desc}, limit: 1) { transaction_version } }"
}
EOF

echo ""

# 7. Sample recent activities
echo "7. Sample of 5 most recent activities:"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r '.data.fungible_asset_activities[] | "\(.type) - \(.owner_address | .[0:10])...\(.owner_address | .[-6:]) - Amount: \(.amount) - Version: \(.transaction_version)"'
{
  "query": "query { fungible_asset_activities(where: {asset_type: {_eq: \"$METADATA\"}}, order_by: {transaction_version: desc}, limit: 5) { owner_address type amount transaction_version } }"
}
EOF

echo ""

# 8. Check if there's a mint event or initial distribution
echo "8. Looking for MINT/GAS_FEE events (initial distribution):"
curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary @- << EOF | jq -r '.data.fungible_asset_activities[] | "\(.type) - \(.owner_address | .[0:10])...\(.owner_address | .[-6:]) - Amount: \(.amount)"'
{
  "query": "query { fungible_asset_activities(where: {asset_type: {_eq: \"$METADATA\"}, type: {_in: [\"0x1::fungible_asset::Deposit\", \"0x1::fungible_asset::Withdraw\"]}}, order_by: {transaction_version: asc}, limit: 20) { owner_address type amount transaction_version } }"
}
EOF

echo ""
echo "=== DEBUG COMPLETE ==="
