# Shelby Pulse API

Backend API service that fetches real-time data from the Shelby blockchain network.

## Overview

This service queries the Shelby network (built on Aptos) using GraphQL to provide real blockchain data for the Shelby Pulse dashboard. It replaces mock data with actual on-chain events and metrics.

## Features

- ✅ **Real Shelby Network Data** - Fetches actual blob events from the blockchain
- ✅ **GraphQL Indexer** - Uses Aptos GraphQL indexer for efficient queries
- ✅ **Caching** - Built-in caching to reduce blockchain RPC load
- ✅ **CORS Enabled** - Ready for frontend consumption
- ✅ **Health Checks** - Monitor API and blockchain connectivity

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

The `.env` file is already configured with the correct Shelby network endpoints:

```env
APTOS_NETWORK=custom
APTOS_NODE_URL=https://api.shelbynet.shelby.xyz/v1
APTOS_INDEXER_URL=https://api.shelbynet.shelby.xyz/v1/graphql
SHELBY_MODULE_ADDRESS=0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5
PORT=3001
CACHE_TTL_SECONDS=30
```

### 3. Run the Service

```bash
pnpm dev
```

The API will start on `http://localhost:3001`

## API Endpoints

### Network Statistics
```bash
GET /api/network/stats
```

Returns real-time network metrics:
- Total blobs on Shelby network
- Total storage used
- Upload rate (blobs/minute)

Example response:
```json
{
  "totalBlobs": 100,
  "totalStorage": 20040948,
  "totalStorageFormatted": "19.11 MB",
  "uploadRate": 1.5,
  "timestamp": 1763351695428
}
```

### Recent Blobs
```bash
GET /api/blobs/recent?limit=20
```

Returns recently registered blobs with metadata.

### Recent Events
```bash
GET /api/events/recent?limit=100
```

Returns raw blob registration events from the blockchain.

### Health Check
```bash
GET /api/health
```

Verifies API and blockchain connectivity.

## How It Works

1. **GraphQL Queries** - Queries the Aptos GraphQL indexer for `BlobRegisteredEvent` events
2. **Data Parsing** - Extracts blob metadata (size, owner, expiration, etc.) from event data
3. **Caching** - Caches results for 30 seconds to minimize blockchain queries
4. **Real-time Updates** - Frontend polls every 5 seconds for live data

## Architecture

```
Frontend (Shelby Pulse)
    ↓ HTTP requests every 5s
Pulse API (this service)
    ↓ GraphQL queries (cached)
Shelby GraphQL Indexer
    ↓ Indexes events from
Shelby Blockchain (Aptos)
```

## Development

### Testing Endpoints

```bash
# Network stats
curl http://localhost:3001/api/network/stats | jq .

# Recent blobs
curl "http://localhost:3001/api/blobs/recent?limit=5" | jq .

# Health check
curl http://localhost:3001/api/health | jq .
```

### Clear Cache

```bash
curl -X POST http://localhost:3001/api/cache/clear
```

## Notes

- The total blob count is limited to 100,000 events due to GraphQL query limits
- Upload rate is calculated based on changes in blob count over time
- All data comes directly from the Shelby blockchain - no mock data
