import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import type { ApiConfig } from "./config";
import { logger } from "./logger";

export interface BlobEvent {
  type: string;
  data: {
    blob_commitment?: string;
    owner?: string;
    creation_micros?: string;
    expiration_micros?: string;
    size_bytes?: string;
    blob_size?: string;
    encoding?: string | { __variant__?: string };
    blob_id?: string;
    blob_name?: string;
  };
  version: string;
  guid: {
    creation_number: string;
    account_address: string;
  };
  sequence_number: string;
  type_: string;
}

export interface StorageProvider {
  address: string;
  datacenter: string;
  chunks_stored: number;
  total_audits: number;
  passed_audits: number;
  audit_pass_rate: number;
}

export interface ShelbyUSDEvent {
  type: 'withdraw' | 'deposit' | 'mint' | 'burn';
  account: string;
  amount: number;
  timestamp: number;
  version: string;
}

// ShelbyUSD fungible asset metadata address
export const SHELBYUSD_METADATA = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";

export class ShelbyAptosClient {
  private aptos: Aptos;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;

    const aptosConfig = new AptosConfig({
      network: Network.CUSTOM,
      fullnode: config.APTOS_NODE_URL,
      indexer: config.APTOS_INDEXER_URL,
    });

    this.aptos = new Aptos(aptosConfig);
    logger.info(
      {
        network: config.APTOS_NETWORK,
        nodeUrl: config.APTOS_NODE_URL,
        indexerUrl: config.APTOS_INDEXER_URL,
        hasApiKey: !!config.APTOS_API_KEY,
      },
      "Initialized Aptos client for Shelby network",
    );
  }

  /**
   * Get headers for GraphQL requests, including API key if available
   */
  private getGraphQLHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.APTOS_API_KEY) {
      headers['Authorization'] = `Bearer ${this.config.APTOS_API_KEY}`;
    }
    return headers;
  }

  /**
   * Get GraphQL config for external services (like blob sync)
   */
  getGraphQLConfig(): { url: string; headers: Record<string, string> } {
    return {
      url: this.config.APTOS_INDEXER_URL!,
      headers: this.getGraphQLHeaders(),
    };
  }

  /**
   * Fetch recent blob registration events using GraphQL
   */
  async fetchBlobEvents(limit = 50): Promise<BlobEvent[]> {
    try {
      // The generic `events` root field no longer exists on the indexer; Shelby
      // exposes a first-class `blobs` table with the fields already parsed.
      const query = `
        query GetRecentBlobs($limit: Int!) {
          blobs(limit: $limit, order_by: {created_at: desc}) {
            uid
            last_transaction_version
            blob_commitment
            owner
            object_name
            size
            encoding
            created_at
            expires_at
            payment_amount
            is_deleted
          }
        }
      `;

      const response = await fetch(this.config.APTOS_INDEXER_URL!, {
        method: 'POST',
        headers: this.getGraphQLHeaders(),
        body: JSON.stringify({ query, variables: { limit } }),
      });

      const result = await response.json();

      if (result.errors) {
        logger.warn({ errors: result.errors }, "GraphQL query returned errors");
        return [];
      }

      const blobs = result.data?.blobs || [];
      // Shape each row like the old BlobRegisteredEvent so downstream consumers
      // (data-service, the live feed) keep working unchanged.
      return blobs.map((b: any) => ({
        type: "shelby::blob_metadata::BlobRegisteredEvent",
        data: {
          blob_id: b.blob_commitment,
          blob_commitment: b.blob_commitment,
          owner: b.owner,
          blob_name: b.object_name,
          blob_size: String(b.size ?? 0),
          size_bytes: String(b.size ?? 0),
          encoding: b.encoding,
          creation_micros: b.created_at != null ? String(b.created_at) : undefined,
          expiration_micros: b.expires_at != null ? String(b.expires_at) : undefined,
          payment_amount: b.payment_amount,
          is_deleted: b.is_deleted,
        },
        version: b.last_transaction_version,
        sequence_number: String(b.uid ?? 0),
        type_: "shelby::blob_metadata::BlobRegisteredEvent",
        guid: {
          creation_number: "0",
          account_address: b.owner ?? "0x0",
        },
      }));
    } catch (error) {
      logger.error({ error }, "Failed to fetch blob events");
      return [];
    }
  }

  /**
   * Get total blob count from events
   * OPTIMIZED: Uses aggregate query first, limited pagination fallback
   */
  async getTotalBlobCount(): Promise<number> {
    try {
      const blobEventType = "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5::blob_metadata::BlobRegisteredEvent";

      // Try aggregate query first (fastest method - O(1))
      try {
        const aggregateQuery = `
          query GetBlobCountAggregate($eventType: String!) {
            events_aggregate(
              where: {type: {_eq: $eventType}}
            ) {
              aggregate {
                count
              }
            }
          }
        `;

        const aggResponse = await fetch(this.config.APTOS_INDEXER_URL!, {
          method: 'POST',
          headers: this.getGraphQLHeaders(),
          body: JSON.stringify({
            query: aggregateQuery,
            variables: { eventType: blobEventType }
          }),
        });

        const aggResult = await aggResponse.json();

        if (aggResult.data?.events_aggregate?.aggregate?.count !== undefined) {
          const count = aggResult.data.events_aggregate.aggregate.count;
          logger.info({ totalCount: count }, "Fetched total blob count via aggregate");
          return count;
        }
      } catch (aggError) {
        logger.debug({ aggError }, "Aggregate query not available, falling back to pagination");
      }

      // Fallback: LIMITED pagination to prevent timeout
      const maxResults = 10000; // Cap at 10k blobs to prevent infinite loops
      let totalCount = 0;
      let offset = 0;
      const limit = 100;
      let hasMore = true;

      while (hasMore && totalCount < maxResults) {
        const query = `
          query GetTotalBlobs($offset: Int!, $limit: Int!, $eventType: String!) {
            events(
              where: {type: {_eq: $eventType}}
              offset: $offset
              limit: $limit
            ) {
              type
            }
          }
        `;

        const response = await fetch(this.config.APTOS_INDEXER_URL!, {
          method: 'POST',
          headers: this.getGraphQLHeaders(),
          body: JSON.stringify({
            query,
            variables: { offset, limit, eventType: blobEventType }
          }),
        });

        const result = await response.json();
        const events = result.data?.events || [];

        totalCount += events.length;

        if (events.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }

      logger.info({ totalCount, capped: totalCount >= maxResults }, "Fetched total blob count via pagination");
      return totalCount;
    } catch (error) {
      logger.warn({ error }, "Failed to fetch total blob count");
      return 0;
    }
  }

  /**
   * Get both total storage and blob count in a single query
   * This avoids rate limits by combining what used to be two separate calls
   */
  async getTotalStorageAndCount(): Promise<{ totalStorage: number; totalBlobs: number }> {
    try {
      const blobEventType = "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5::blob_metadata::BlobRegisteredEvent";

      // Using limited pagination to prevent timeout
      const maxResults = 10000; // Cap at 10k blobs
      let totalBytes = 0;
      let offset = 0;
      let count = 0;
      const limit = 100;
      let hasMore = true;

      while (hasMore && count < maxResults) {
        const query = `
          query GetTotalStorage($offset: Int!, $limit: Int!, $eventType: String!) {
            events(
              where: {type: {_eq: $eventType}}
              offset: $offset
              limit: $limit
            ) {
              data
            }
          }
        `;

        const response = await fetch(this.config.APTOS_INDEXER_URL!, {
          method: 'POST',
          headers: this.getGraphQLHeaders(),
          body: JSON.stringify({
            query,
            variables: { offset, limit, eventType: blobEventType }
          }),
        });

        const result = await response.json();

        // Check for rate limit errors
        if (result.errors?.length > 0) {
          const rateLimitError = result.errors.find((e: { extensions?: { code?: string } }) => e.extensions?.code === "429");
          if (rateLimitError) {
            logger.warn("Rate limited during storage query, returning partial results");
            break;
          }
        }

        const events = result.data?.events || [];

        for (const event of events) {
          const sizeBytes = Number.parseInt(event.data?.blob_size || "0", 10);
          totalBytes += sizeBytes;
        }

        count += events.length;

        if (events.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }

      logger.info({ totalBytes, totalBlobs: count, capped: count >= maxResults }, "Fetched total storage and blob count");
      return { totalStorage: totalBytes, totalBlobs: count };
    } catch (error) {
      logger.warn({ error }, "Failed to fetch total storage");
      return { totalStorage: 0, totalBlobs: 0 };
    }
  }

  /**
   * Get total storage size from events (uses combined query)
   */
  async getTotalStorage(): Promise<number> {
    const { totalStorage } = await this.getTotalStorageAndCount();
    return totalStorage;
  }

  /**
   * Fetch storage providers from on-chain resources using REST API
   * First queries the module address for the StorageProviders registry,
   * then fetches details for each provider address
   */
  async fetchStorageProviders(): Promise<StorageProvider[]> {
    try {
      // Step 1: Get the StorageProviders registry from the module address
      const registryUrl = `${this.config.APTOS_NODE_URL}/accounts/${this.config.SHELBY_MODULE_ADDRESS}/resource/${this.config.SHELBY_MODULE_ADDRESS}::global_metadata::StorageProviders`;

      const registryResponse = await fetch(registryUrl);
      if (!registryResponse.ok) {
        logger.warn({ status: registryResponse.status }, "Failed to fetch StorageProviders registry");
        return [];
      }

      const registry = await registryResponse.json();
      const providerAddresses: string[] = registry.data?.providers?.inline_vec || [];

      if (providerAddresses.length === 0) {
        logger.info("No storage providers found in registry");
        return [];
      }

      // Step 2: Fetch details for each provider
      const providerResults = await Promise.all(
        providerAddresses.map(async (address) => {
          try {
            const providerUrl = `${this.config.APTOS_NODE_URL}/accounts/${address}/resource/${this.config.SHELBY_MODULE_ADDRESS}::storage_provider::StorageProvider`;
            const response = await fetch(providerUrl);

            if (!response.ok) {
              logger.warn({ address, status: response.status }, "Failed to fetch provider details");
              return null;
            }

            const resource = await response.json();
            const data = resource.data;

            // Extract data center from failure_domain
            const datacenter = data.failure_domain?.vec?.[0]?.data_center || 'unknown';

            // Extract num_chunksets_stored
            const chunksStored = parseInt(data.num_chunksets_stored?.value || '0', 10);

            return {
              address,
              datacenter,
              chunks_stored: chunksStored,
              total_audits: 100,
              passed_audits: 100,
              audit_pass_rate: 1.0,
            };
          } catch (error) {
            logger.warn({ address, error }, "Error fetching provider details");
            return null;
          }
        })
      );

      // Filter out failed fetches
      const validProviders: StorageProvider[] = providerResults.filter((p): p is StorageProvider => p !== null);

      logger.info({ providerCount: validProviders.length }, "Fetched storage providers");
      return validProviders;
    } catch (error) {
      logger.warn({ error }, "Failed to fetch storage providers");
      return [];
    }
  }

  /**
   * Get ShelbyUSD balances from current_fungible_asset_balances table
   * Uses pagination to fetch ALL balances (GraphQL limit is ~100 per query)
   */
  async getShelbyUSDBalances(maxResults = 10000): Promise<Array<{owner: string, balance: number}>> {
    try {
      const allBalances: Array<{owner: string, balance: number}> = [];
      const pageSize = 100; // GraphQL server limit
      let offset = 0;
      let hasMore = true;

      while (hasMore && allBalances.length < maxResults) {
        const query = `
          query GetShelbyUSDBalances($limit: Int!, $offset: Int!, $metadata: String!) {
            current_fungible_asset_balances(
              where: {asset_type: {_eq: $metadata}}
              order_by: {amount: desc}
              limit: $limit
              offset: $offset
            ) {
              owner_address
              amount
            }
          }
        `;

        const response = await fetch(this.config.APTOS_INDEXER_URL!, {
          method: 'POST',
          headers: this.getGraphQLHeaders(),
          body: JSON.stringify({
            query,
            variables: {
              limit: pageSize,
              offset,
              metadata: SHELBYUSD_METADATA
            },
          }),
        });

        const result = await response.json();

        if (result.errors) {
          logger.warn({ errors: result.errors }, "GraphQL query returned errors");
          break;
        }

        const balances = result.data?.current_fungible_asset_balances || [];

        if (balances.length === 0) {
          hasMore = false;
          break;
        }

        for (const b of balances) {
          allBalances.push({
            owner: b.owner_address,
            balance: Number.parseInt(b.amount || "0", 10),
          });
        }

        offset += pageSize;

        // If we got fewer results than page size, we've reached the end
        if (balances.length < pageSize) {
          hasMore = false;
        }
      }

      logger.info({ totalBalances: allBalances.length, totalSupply: allBalances.reduce((sum, b) => sum + b.balance, 0) }, "Fetched all ShelbyUSD balances");
      return allBalances;
    } catch (error) {
      logger.error({ error }, "Failed to fetch ShelbyUSD balances");
      return [];
    }
  }

  /**
   * Fetch ShelbyUSD withdraw and deposit events
   */
  async getShelbyUSDEvents(limit = 1000): Promise<ShelbyUSDEvent[]> {
    try {
      // Query both Withdraw and Deposit events for fungible assets
      const query = `
        query GetFungibleAssetEvents($limit: Int!) {
          events(
            limit: $limit
            order_by: {transaction_version: desc}
            where: {
              _or: [
                {type: {_eq: "0x1::fungible_asset::Withdraw"}},
                {type: {_eq: "0x1::fungible_asset::Deposit"}}
              ]
            }
          ) {
            type
            data
            transaction_version
            account_address
          }
        }
      `;

      const response = await fetch(this.config.APTOS_INDEXER_URL!, {
        method: 'POST',
        headers: this.getGraphQLHeaders(),
        body: JSON.stringify({
          query,
          variables: { limit },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        logger.warn({ errors: result.errors }, "GraphQL query returned errors");
        return [];
      }

      const events = result.data?.events || [];

      // For now, return all events - we'll need to filter by store metadata later
      // This is a simplified version - ideally we'd look up store metadata
      const shelbyUSDEvents: ShelbyUSDEvent[] = events.map((event: any) => ({
        type: event.type.includes('Withdraw') ? 'withdraw' as const : 'deposit' as const,
        account: event.account_address,
        amount: Number.parseInt(event.data?.amount || "0", 10),
        timestamp: Date.now(),
        version: event.transaction_version,
      }));

      return shelbyUSDEvents;
    } catch (error) {
      logger.error({ error }, "Failed to fetch ShelbyUSD events");
      return [];
    }
  }

  /**
   * Get ShelbyUSD activities from fungible_asset_activities table
   * Uses pagination to fetch ALL activities (GraphQL limit is ~100 per query)
   */
  async getShelbyUSDActivities(maxResults = 100000): Promise<Array<{
    owner: string;
    type: 'deposit' | 'withdraw' | 'mint' | 'burn';
    amount: number;
    version: string;
  }>> {
    try {
      const allActivities: Array<{
        owner: string;
        type: 'deposit' | 'withdraw' | 'mint' | 'burn';
        amount: number;
        version: string;
      }> = [];
      const pageSize = 100; // GraphQL server limit
      let offset = 0;
      let hasMore = true;

      while (hasMore && allActivities.length < maxResults) {
        const query = `
          query GetShelbyUSDActivities($limit: Int!, $offset: Int!, $metadata: String!) {
            fungible_asset_activities(
              where: {asset_type: {_eq: $metadata}}
              order_by: {transaction_version: desc}
              limit: $limit
              offset: $offset
            ) {
              owner_address
              type
              amount
              transaction_version
              is_frozen
            }
          }
        `;

        const response = await fetch(this.config.APTOS_INDEXER_URL!, {
          method: 'POST',
          headers: this.getGraphQLHeaders(),
          body: JSON.stringify({
            query,
            variables: {
              limit: pageSize,
              offset,
              metadata: SHELBYUSD_METADATA
            },
          }),
        });

        const result = await response.json();

        if (result.errors) {
          logger.warn({ errors: result.errors }, "GraphQL query returned errors");
          break;
        }

        const activities = result.data?.fungible_asset_activities || [];

        if (activities.length === 0) {
          hasMore = false;
          break;
        }

        for (const activity of activities) {
          // Parse the type from GraphQL (e.g., "0x1::fungible_asset::Deposit" -> "deposit")
          const typeStr = activity.type.toLowerCase();
          let activityType: 'deposit' | 'withdraw' | 'mint' | 'burn' = 'deposit';

          if (typeStr.includes('withdraw')) {
            activityType = 'withdraw';
          } else if (typeStr.includes('mint')) {
            activityType = 'mint';
          } else if (typeStr.includes('burn')) {
            activityType = 'burn';
          } else if (typeStr.includes('deposit')) {
            activityType = 'deposit';
          }

          allActivities.push({
            owner: activity.owner_address,
            type: activityType,
            amount: Number.parseInt(activity.amount || "0", 10),
            version: activity.transaction_version,
          });
        }

        offset += pageSize;

        // If we got fewer results than page size, we've reached the end
        if (activities.length < pageSize) {
          hasMore = false;
        }
      }

      logger.info(
        {
          totalActivities: allActivities.length,
          deposits: allActivities.filter(a => a.type === 'deposit').length,
          withdraws: allActivities.filter(a => a.type === 'withdraw').length,
          mints: allActivities.filter(a => a.type === 'mint').length,
          burns: allActivities.filter(a => a.type === 'burn').length,
        },
        "Fetched all ShelbyUSD activities"
      );
      return allActivities;
    } catch (error) {
      logger.error({ error }, "Failed to fetch ShelbyUSD activities");
      return [];
    }
  }

  /**
   * Get recent ShelbyUSD deposits for a specific user address
   * Returns deposits with transaction hash for explorer links
   */
  async getUserShelbyUSDDeposits(
    userAddress: string,
    sinceVersion?: string,
    limit = 20
  ): Promise<Array<{
    txHash: string;
    amount: number;
    version: string;
    timestamp?: string;
  }>> {
    try {
      // Build the where clause
      const whereConditions: string[] = [
        `asset_type: {_eq: "${SHELBYUSD_METADATA}"}`,
        `owner_address: {_eq: "${userAddress}"}`,
        `type: {_eq: "0x1::fungible_asset::Deposit"}`
      ];

      if (sinceVersion) {
        whereConditions.push(`transaction_version: {_gt: "${sinceVersion}"}`);
      }

      const query = `
        query GetUserDeposits($limit: Int!) {
          fungible_asset_activities(
            where: {${whereConditions.join(', ')}}
            order_by: {transaction_version: desc}
            limit: $limit
          ) {
            owner_address
            amount
            transaction_version
          }
        }
      `;

      const response = await fetch(this.config.APTOS_INDEXER_URL!, {
        method: 'POST',
        headers: this.getGraphQLHeaders(),
        body: JSON.stringify({
          query,
          variables: { limit },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        logger.warn({ errors: result.errors }, "GraphQL query returned errors");
        return [];
      }

      const activities = result.data?.fungible_asset_activities || [];

      // Fetch transaction hashes for each version
      const depositsWithHash = await Promise.all(
        activities.map(async (activity: any) => {
          const version = activity.transaction_version;
          let txHash = '';

          try {
            const txResponse = await fetch(
              `${this.config.APTOS_NODE_URL}/transactions/by_version/${version}`
            );
            if (txResponse.ok) {
              const txData = await txResponse.json();
              txHash = txData.hash || '';
            }
          } catch (err) {
            logger.warn({ version, err }, "Failed to fetch tx hash for version");
          }

          return {
            txHash,
            amount: Number.parseInt(activity.amount || "0", 10),
            version: version.toString(),
          };
        })
      );

      logger.info(
        { userAddress, depositsFound: depositsWithHash.length, sinceVersion },
        "Fetched user ShelbyUSD deposits"
      );

      return depositsWithHash;
    } catch (error) {
      logger.error({ error, userAddress }, "Failed to fetch user ShelbyUSD deposits");
      return [];
    }
  }

  /**
   * Get the Aptos client instance for advanced queries
   */
  getClient(): Aptos {
    return this.aptos;
  }
}
