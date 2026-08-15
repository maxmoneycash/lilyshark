# Shelby Pulse API - CRUSH.md

This document helps agents work effectively in the Shelby Pulse API repository. It contains essential information about commands, code patterns, conventions, and project structure.

## Project Overview

Shelby Pulse API is a Node.js/TypeScript Express service that provides real-time data from the Shelby blockchain network (built on Aptos). It fetches blob storage events, network statistics, and ShelbyUSD economy data via GraphQL indexer queries, with built-in caching to reduce blockchain load.

## Essential Commands

### Development
- **Install dependencies**: `pnpm install` (README suggests pnpm, but npm scripts work too)
- **Run in development**: `pnpm dev` - Uses tsx watch for hot reload
- **Build for production**: `pnpm build` - Compiles TypeScript to `dist/`
- **Run production build**: `pnpm start` - Runs `node dist/index.js`

### Testing & Debugging
- **Test all API endpoints**: `./test-api.sh [url]` - Curl-based endpoint testing with colored output
- **Debug ShelbyUSD data**: `./debug-shelbyusd.sh` - Direct GraphQL queries for economy data analysis
- **Health check**: `curl http://localhost:3001/api/health`
- **Clear cache**: `curl -X POST http://localhost:3001/api/cache/clear`

### Docker
- **Build container**: `docker build -t shelby-pulse-api .`
- **Run container**: `docker run -p 3001:3001 shelby-pulse-api`

## Code Organization

```
src/
├── index.ts           # Main entry point, Express app setup
├── config.ts          # Environment configuration with Zod validation
├── logger.ts          # Pino logging setup
├── routes.ts          # API route definitions
├── data-service.ts    # Core business logic and caching
├── aptos-client.ts    # Aptos blockchain client
└── shelbyusd/         # ShelbyUSD economy data modules
    ├── leaderboard.ts
    ├── volume.ts
    ├── activity.ts
    ├── spenders.ts
    ├── earners.ts
    └── all-time-stats.ts
```

## Key Patterns & Conventions

### Configuration
- Uses Zod schemas for runtime environment validation
- All config loaded from environment variables via `dotenv`
- Defaults provided for Shelby network endpoints
- Required: `APTOS_NODE_URL`, `APTOS_INDEXER_URL`
- Optional: `PORT` (3001), `CACHE_TTL_SECONDS` (30), `LOG_LEVEL` (info)

### Logging
- Pino logger with structured JSON output
- Pretty-printed in development (`NODE_ENV` ≠ "production")
- Request logging middleware tracks method, path, status, duration
- Error logging includes full error objects

### API Structure
- RESTful endpoints under `/api/`
- Express with CORS enabled, JSON middleware
- Async route handlers with try/catch error handling
- Consistent error responses: `{ error: "message" }`

### Caching Strategy
- Node-cache with configurable TTL (30s default)
- Cache keys: `network_stats`, `recent_blobs_${limit}`, `all_events_${limit}`, `economy_data`
- Cache cleared via POST `/api/cache/clear` endpoint
- Reduces GraphQL indexer load

### Blockchain Interaction
- Aptos SDK v1.39+ for custom network configuration
- GraphQL queries to indexer for events and balances
- Pagination handling for large result sets (100 per page)
- ShelbyUSD metadata address: `0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1`

### Data Processing
- Event data parsing from GraphQL responses
- Address shortening: `0x1234...abcd` format
- Byte formatting: converts to human-readable units (KB, MB, GB)
- Timestamp handling: microseconds to milliseconds conversion

## TypeScript Configuration

- Target: ES2022, Module: CommonJS
- Strict mode enabled
- Source in `src/`, compiled to `dist/`
- Includes: `src/**/*`, Excludes: node_modules

## Dependencies

### Runtime
- `express` - Web framework
- `@aptos-labs/ts-sdk` - Aptos blockchain SDK
- `cors` - CORS middleware
- `dotenv` - Environment loading
- `node-cache` - In-memory caching
- `pino` - Structured logging
- `zod` - Schema validation

### Development
- `@types/*` - TypeScript definitions
- `tsx` - TypeScript execution/runner
- `typescript` - Compiler
- `pino-pretty` - Dev logging formatter

## API Endpoints

### Core Endpoints
- `GET /` - API info and endpoint list
- `GET /api/health` - Health check with blockchain connectivity
- `GET /api/network/stats` - Blob count, storage size, upload rate
- `GET /api/blobs/recent?limit=20` - Recent blob registrations
- `GET /api/events/recent?limit=100` - Raw blob events
- `GET /api/providers` - Storage provider information (placeholder)

### Economy Endpoints
- `GET /api/economy` - Complete ShelbyUSD data (leaderboard, volume, stats, activity)

### Admin Endpoints
- `POST /api/cache/clear` - Clear all cached data

## Important Gotchas

### Shelby Network Specifics
- Custom Aptos network with dedicated endpoints
- GraphQL indexer limits queries to 100,000 results
- Some features like storage providers not fully implemented
- ShelbyUSD uses specific fungible asset metadata address

### Development Notes
- Uses `pnpm` in docs but npm scripts work fine
- Hot reload in dev via tsx watch
- Production builds require TypeScript compilation
- Cache TTL affects real-time data freshness

### Error Handling
- Network failures logged but don't crash the service
- GraphQL errors return empty arrays instead of throwing
- Invalid config throws on startup with detailed Zod messages
- Health check verifies blockchain connectivity

### Performance Considerations
- Large GraphQL queries paginated to avoid timeouts
- Caching prevents excessive blockchain queries
- Concurrent requests handled via Promise.all
- Upload rate calculated from blob count changes over time

## Testing Approach

- Manual endpoint testing via shell scripts
- No automated unit tests currently
- Integration testing through API calls
- Debug scripts for data validation
- Health checks for service monitoring

## Environment Setup

Copy `.env.example` to `.env` with:
```
APTOS_NETWORK=custom
APTOS_NODE_URL=https://api.shelbynet.shelby.xyz/v1
APTOS_INDEXER_URL=https://api.shelbynet.shelby.xyz/v1/graphql
SHELBY_MODULE_ADDRESS=0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5
PORT=3001
CACHE_TTL_SECONDS=30
```

## Deployment

- Docker container exposes port 3001
- Production builds use compiled JavaScript
- Graceful shutdown on SIGINT/SIGTERM
- No database dependencies (stateless)</content>
<parameter name="file_path">CRUSH.md