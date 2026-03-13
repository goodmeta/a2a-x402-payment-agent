/**
 * x402 Payment Client
 *
 * Handles the full x402 payment flow:
 * 1. Make initial request to a URL
 * 2. If 402 → parse payment requirements from response
 * 3. Sign an ERC-2612 permit (off-chain, gasless)
 * 4. Retry the request with the payment signature header
 *
 * Uses viem for all crypto operations. No proprietary SDK needed —
 * x402 is just HTTP + EIP-712 signatures.
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

// ERC-20 ABI fragments we need
const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "nonces",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// x402 payment requirements (from 402 response body)
interface PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  extra?: { name: string; version: string };
}

interface PaymentRequiredResponse {
  x402Version: number;
  error: string;
  accepts: PaymentRequirement[];
}

// Facilitator response
interface FacilitatorSigners {
  signers: Record<string, string[]>;
}

export interface X402FetchResult {
  response: Response;
  paid: boolean;
  amount?: string;
  txHash?: string;
}

export class X402Client {
  private account: PrivateKeyAccount;
  private publicClient: PublicClient;
  private chain: Chain;
  private facilitatorUrl: string;

  constructor(config: {
    privateKey: Hex;
    chain: "base" | "base-sepolia";
    facilitatorUrl: string;
  }) {
    this.account = privateKeyToAccount(config.privateKey);
    this.chain = config.chain === "base" ? base : baseSepolia;
    this.facilitatorUrl = config.facilitatorUrl;
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(),
    });
  }

  get address() {
    return this.account.address;
  }

  /**
   * Fetch a URL, automatically handling x402 payment if required.
   */
  async paidFetch(
    url: string,
    init?: RequestInit
  ): Promise<X402FetchResult> {
    // Step 1: Initial request
    const firstResponse = await fetch(url, init);

    if (firstResponse.status !== 402) {
      return { response: firstResponse, paid: false };
    }

    // Step 2: Parse payment requirements
    const paymentRequired =
      (await firstResponse.json()) as PaymentRequiredResponse;
    const requirement = paymentRequired.accepts[0];

    if (!requirement) {
      throw new Error("No payment requirements in 402 response");
    }

    console.log(
      `[x402] Payment required: ${requirement.maxAmountRequired} base units to ${requirement.payTo}`
    );

    // Step 3: Get facilitator signer address
    const facilitatorSigners = (await fetch(
      `${this.facilitatorUrl}/supported`
    ).then((r) => r.json())) as FacilitatorSigners;

    const signerKey = Object.keys(facilitatorSigners.signers).find(
      (k) => k === "eip155:*" || k === requirement.network
    );
    const facilitatorSigner = signerKey
      ? facilitatorSigners.signers[signerKey]?.[0]
      : undefined;

    if (!facilitatorSigner) {
      throw new Error(
        `Facilitator doesn't support network ${requirement.network}`
      );
    }

    // Step 4: Read on-chain state (balance + nonce)
    const [balance, nonce] = await Promise.all([
      this.publicClient.readContract({
        address: requirement.asset as Hex,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.account.address],
      }),
      this.publicClient.readContract({
        address: requirement.asset as Hex,
        abi: erc20Abi,
        functionName: "nonces",
        args: [this.account.address],
      }),
    ]);

    const amount = BigInt(requirement.maxAmountRequired);
    if (balance < amount) {
      throw new Error(
        `Insufficient balance: have ${balance}, need ${amount}`
      );
    }

    // Step 5: Sign ERC-2612 permit
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + (requirement.maxTimeoutSeconds || 300)
    );

    const domain = {
      name: requirement.extra?.name ?? "USD Coin",
      version: requirement.extra?.version ?? "2",
      chainId: BigInt(this.chain.id),
      verifyingContract: requirement.asset as Hex,
    };

    const permitTypes = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const;

    const permitMessage = {
      owner: this.account.address,
      spender: facilitatorSigner as Hex,
      value: amount,
      nonce: nonce as bigint,
      deadline,
    };

    const signature = await this.account.signTypedData({
      domain,
      types: permitTypes,
      primaryType: "Permit",
      message: permitMessage,
    });

    console.log(`[x402] Permit signed, retrying with payment header`);

    // Step 6: Build payment payload and retry
    const isV2 = paymentRequired.x402Version === 2;

    const payload = isV2
      ? {
          x402Version: 2,
          accepted: {
            scheme: requirement.scheme,
            network: requirement.network,
          },
          payload: {
            signature,
            authorization: {
              from: this.account.address,
              to: facilitatorSigner,
              value: amount.toString(),
              validAfter: "0",
              validBefore: deadline.toString(),
              nonce: (nonce as bigint).toString(),
            },
          },
        }
      : {
          x402Version: 1,
          scheme: requirement.scheme,
          network: requirement.network,
          payload: {
            signature,
            authorization: {
              from: this.account.address,
              to: facilitatorSigner,
              value: amount.toString(),
              validAfter: "0",
              validBefore: deadline.toString(),
              nonce: (nonce as bigint).toString(),
            },
          },
        };

    const encodedPayload = btoa(JSON.stringify(payload));
    const headerName = isV2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT";

    const paidResponse = await fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(
          new Headers(init?.headers).entries()
        ),
        [headerName]: encodedPayload,
      },
    });

    // Extract tx hash from receipt header if present
    const receipt = paidResponse.headers.get("X-PAYMENT-RECEIPT");
    let txHash: string | undefined;
    if (receipt) {
      try {
        const decoded = JSON.parse(atob(receipt));
        txHash = decoded.txHash || decoded.transaction;
      } catch {}
    }

    console.log(
      `[x402] Payment complete. Status: ${paidResponse.status}${txHash ? `, tx: ${txHash}` : ""}`
    );

    return {
      response: paidResponse,
      paid: true,
      amount: amount.toString(),
      txHash,
    };
  }
}
