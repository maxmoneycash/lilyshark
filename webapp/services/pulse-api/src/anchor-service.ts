/**
 * On-chain anchoring for published captures (task UI-002).
 *
 * After the share service uploads a capture to Shelby, this service registers
 * it in `lilyshark::capture_registry` (contracts/capture-registry) under the
 * service account — the same key that paid the upload — so the capture's own
 * RESOLVE trace can show a real anchor instead of "no on-chain anchor".
 *
 * Anchoring is best-effort by design: every failure is caught and returned as
 * a value, never thrown, so a chain hiccup can never fail a publish that
 * already succeeded. The client renders the honest state either way.
 */
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { logger } from "./logger";

/** What the upload response reports about the on-chain anchor. */
export type AnchorResult =
  | {
      status: "anchored";
      /** Null when the capture was already anchored in an earlier publish. */
      txHash: string | null;
      publisher: string;
      alreadyAnchored: boolean;
    }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export interface AnchorRequest {
  /** 0x-prefixed 32-byte Shelby blob commitment (Merkle root). */
  commitment: string;
  /** Blob name under the service account's Shelby namespace. */
  blobName: string;
  sizeBytes: number;
  /** Lease expiry, unix seconds (the registry stores seconds, not micros). */
  expiresAtUnix: number;
}

export interface AnchorServiceOptions {
  /** Ed25519 private key hex; omit to leave the service unavailable. */
  privateKey?: string;
  /** Aptos fullnode REST base, e.g. https://api.shelbynet.shelby.xyz/v1 */
  nodeUrl: string;
  /** Account that hosts lilyshark::capture_registry. */
  registryAddress: string;
  /** Build but never submit the register transaction. */
  dryRun?: boolean;
}

const COMMITMENT_RE = /^0x[0-9a-f]{64}$/;

function hexToBytes(hex: string): Uint8Array {
  const body = hex.slice(2);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export class AnchorService {
  private account: Account | null = null;
  private readonly aptos: Aptos;
  private readonly nodeUrl: string;
  private readonly registryAddress: string;
  private readonly dryRun: boolean;

  constructor(options: AnchorServiceOptions) {
    this.nodeUrl = options.nodeUrl.replace(/\/$/, "");
    this.registryAddress = options.registryAddress;
    this.dryRun = options.dryRun === true;
    this.aptos = new Aptos(
      new AptosConfig({ network: Network.CUSTOM, fullnode: options.nodeUrl }),
    );
    if (options.privateKey) {
      try {
        this.account = Account.fromPrivateKey({
          privateKey: new Ed25519PrivateKey(
            options.privateKey.replace(/^ed25519-priv-/, ""),
          ),
        });
        logger.info(
          {
            publisher: this.account.accountAddress.toString(),
            registry: this.registryAddress,
            dryRun: this.dryRun,
          },
          "Anchor service initialized",
        );
      } catch (error) {
        logger.error({ error }, "Failed to initialize anchor service key");
        this.account = null;
      }
    }
  }

  isAvailable(): boolean {
    return this.account !== null;
  }

  getPublisher(): string | null {
    return this.account?.accountAddress.toString() ?? null;
  }

  /**
   * Registry v1 has no on-chain dedupe (see task CO-004), but the service
   * always anchors under its own account, so one fullnode GET of its own
   * Registry resource is enough to avoid double-registering a re-published
   * capture. A failed read only means we may register a duplicate — v1's
   * accepted behavior — never that we skip a real anchor.
   */
  async isAlreadyAnchored(commitment: string): Promise<boolean> {
    const publisher = this.getPublisher();
    if (!publisher) return false;
    const res = await fetch(
      `${this.nodeUrl}/accounts/${publisher}/resource/${this.registryAddress}::capture_registry::Registry`,
    );
    if (res.status === 404) return false; // no registry yet
    if (!res.ok) throw new Error(`fullnode HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: { captures?: { commitment: string }[] };
    };
    return (body.data?.captures ?? []).some(
      (c) => c.commitment.toLowerCase() === commitment,
    );
  }

  /**
   * Anchor one uploaded capture. Never throws: the caller folds the returned
   * value into the upload response and the publish succeeds regardless.
   */
  async anchorCapture(req: AnchorRequest): Promise<AnchorResult> {
    if (!this.account) {
      return {
        status: "skipped",
        reason: "no anchoring key configured (SHELBY_PRIVATE_KEY)",
      };
    }
    const publisher = this.account.accountAddress.toString();
    const commitment = (req.commitment ?? "").toLowerCase();
    if (!COMMITMENT_RE.test(commitment)) {
      // The registry aborts on anything but 32 bytes; without the read-back
      // commitment there is nothing truthful to anchor.
      return {
        status: "failed",
        reason:
          "blob commitment unavailable after upload — capture stored but not anchored",
      };
    }

    try {
      if (await this.isAlreadyAnchored(commitment)) {
        logger.info(
          { commitment, blobName: req.blobName },
          "Capture already anchored; skipping duplicate register",
        );
        return { status: "anchored", txHash: null, publisher, alreadyAnchored: true };
      }
    } catch (error) {
      logger.warn(
        { error, commitment },
        "Registry dedupe read failed; registering anyway",
      );
    }

    try {
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.account.accountAddress,
        data: {
          function:
            `${this.registryAddress}::capture_registry::register` as `${string}::${string}::${string}`,
          functionArguments: [
            hexToBytes(commitment),
            req.blobName,
            Math.max(0, Math.floor(req.sizeBytes)),
            Math.max(0, Math.floor(req.expiresAtUnix)),
          ],
        },
      });

      if (this.dryRun) {
        logger.info(
          { commitment, blobName: req.blobName },
          "ANCHOR_DRY_RUN: register transaction built, not submitted",
        );
        return {
          status: "skipped",
          reason: "dry run: register transaction built but not submitted",
        };
      }

      const pending = await this.aptos.signAndSubmitTransaction({
        signer: this.account,
        transaction,
      });
      const committed = await this.aptos.waitForTransaction({
        transactionHash: pending.hash,
      });
      if (committed.success === false) {
        return {
          status: "failed",
          reason: `register aborted on-chain: ${committed.vm_status ?? "unknown vm_status"}`,
        };
      }
      logger.info(
        { txHash: pending.hash, commitment, blobName: req.blobName, publisher },
        "Capture anchored in lilyshark::capture_registry",
      );
      return {
        status: "anchored",
        txHash: pending.hash,
        publisher,
        alreadyAnchored: false,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(
        { errMsg: reason, commitment, blobName: req.blobName },
        "Failed to anchor capture (publish still succeeded)",
      );
      return { status: "failed", reason };
    }
  }
}
