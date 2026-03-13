/**
 * Agent Card — the identity and capability declaration for this agent.
 *
 * Published at /.well-known/agent-card.json so other agents can
 * discover what this agent does, what inputs it accepts, and how
 * to authenticate.
 */

import type { AgentCard } from "@a2a-js/sdk";

export function createAgentCard(baseUrl: string): AgentCard {
  return {
    name: "x402 Payment Agent",
    description:
      "Fetches x402-protected APIs on your behalf, handling payment automatically via ERC-2612 permit signing. " +
      "Send a URL and this agent pays for access and returns the result.",
    url: baseUrl,
    version: "1.0.0",
    protocolVersion: "0.3.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ["text", "application/json"],
    defaultOutputModes: ["text", "application/json"],
    skills: [
      {
        id: "paid_fetch",
        name: "Paid Fetch",
        description:
          "Fetch any x402-protected URL. Automatically detects HTTP 402 responses, " +
          "signs an ERC-2612 USDC permit, and retries with payment. " +
          "Send a URL as text, or a JSON object with { url, method, headers, body }.",
        tags: ["x402", "payment", "fetch", "usdc", "erc2612"],
        examples: [
          "https://api.example.com/search?q=AI+agents",
          '{"url": "https://paid-api.example.com/v1/data", "method": "POST", "body": "{\\"query\\": \\"test\\"}"}',
        ],
        inputModes: ["text", "application/json"],
        outputModes: ["text", "application/json"],
      },
    ],
  };
}
