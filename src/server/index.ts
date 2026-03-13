/**
 * A2A x402 Payment Agent — Server Entry Point
 *
 * Starts an Express server that speaks the A2A protocol.
 * Other agents can discover this agent via its Agent Card,
 * send it URLs, and receive paid API responses.
 */

import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { createAgentCard } from "./agent-card.js";
import { PaymentAgentExecutor } from "./executor.js";
import { X402Client } from "./x402.js";
import type { Hex } from "viem";

// --- Config ---

const PORT = parseInt(process.env.PORT || "3000", 10);
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
const CHAIN = (process.env.CHAIN || "base-sepolia") as "base" | "base-sepolia";
const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://x402.stablecoin.xyz";

if (!PRIVATE_KEY) {
  console.error(
    "AGENT_PRIVATE_KEY is required. Copy .env.example to .env and fill it in."
  );
  process.exit(1);
}

// --- Bootstrap ---

const baseUrl = `http://localhost:${PORT}/`;
const agentCard = createAgentCard(baseUrl);

const x402Client = new X402Client({
  privateKey: PRIVATE_KEY,
  chain: CHAIN,
  facilitatorUrl: FACILITATOR_URL,
});

const executor = new PaymentAgentExecutor(x402Client);
const taskStore = new InMemoryTaskStore();
const requestHandler = new DefaultRequestHandler(
  agentCard,
  taskStore,
  executor
);

// --- Express App ---

const app = express();

// Agent Card discovery endpoint
app.use(
  `/${AGENT_CARD_PATH}`,
  agentCardHandler({ agentCardProvider: requestHandler })
);

// A2A JSON-RPC endpoint (primary protocol)
app.use(
  jsonRpcHandler({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
  })
);

// A2A REST endpoint (alternative binding)
app.use(
  "/rest",
  restHandler({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
  })
);

app.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────────────────┐
│  x402 Payment Agent (A2A)                       │
├─────────────────────────────────────────────────┤
│  Agent Card:  ${baseUrl}.well-known/agent-card.json
│  JSON-RPC:    ${baseUrl}
│  REST:        ${baseUrl}rest/
│  Chain:       ${CHAIN}
│  Wallet:      ${x402Client.address}
│  Facilitator: ${FACILITATOR_URL}
└─────────────────────────────────────────────────┘
  `);
});
