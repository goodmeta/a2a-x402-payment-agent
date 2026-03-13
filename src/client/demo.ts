/**
 * Demo A2A Client
 *
 * Discovers the x402 Payment Agent via its Agent Card,
 * then sends it a URL to fetch. Demonstrates both
 * request/response and streaming modes.
 */

import { ClientFactory } from "@a2a-js/sdk/client";
import type {
  MessageSendParams,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Message,
} from "@a2a-js/sdk";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:3000";
const TARGET_URL =
  process.argv[2] || "https://api.example.com/search?q=AI+agents";

async function main() {
  console.log(`\n--- A2A x402 Payment Agent Demo ---\n`);

  // Step 1: Discover the agent
  console.log(`Discovering agent at ${AGENT_URL}...`);
  const factory = new ClientFactory();
  const client = await factory.createFromUrl(AGENT_URL);
  const card = await client.getAgentCard();

  console.log(`Found: ${card.name}`);
  console.log(`Skills: ${card.skills.map((s) => s.name).join(", ")}`);
  console.log(`Streaming: ${card.capabilities?.streaming ? "yes" : "no"}\n`);

  // Step 2: Send a task (streaming mode)
  const params: MessageSendParams = {
    message: {
      kind: "message",
      messageId: crypto.randomUUID(),
      role: "user",
      parts: [{ kind: "text", text: TARGET_URL }],
    },
  };

  if (card.capabilities?.streaming) {
    console.log(`Sending task (streaming): fetch ${TARGET_URL}\n`);

    for await (const event of client.sendMessageStream(params)) {
      switch (event.kind) {
        case "status-update": {
          const e = event as TaskStatusUpdateEvent;
          const statusMsg = e.status.message;
          const text =
            statusMsg && "parts" in statusMsg
              ? (statusMsg.parts as any[])
                  .filter((p: any) => p.kind === "text")
                  .map((p: any) => p.text)
                  .join("")
              : "";
          console.log(`[${e.status.state}]${text ? " " + text : ""}`);
          break;
        }
        case "artifact-update": {
          const e = event as TaskArtifactUpdateEvent;
          console.log(`\n--- Artifact: ${e.artifact.name || e.artifact.artifactId} ---`);
          for (const part of e.artifact.parts) {
            if (part.kind === "text") {
              console.log((part as any).text);
            } else if (part.kind === "data") {
              console.log(JSON.stringify((part as any).data, null, 2));
            }
          }
          if (e.artifact.metadata) {
            console.log(`\nMetadata:`, e.artifact.metadata);
          }
          break;
        }
        case "message": {
          const m = event as Message;
          const text = (m.parts as any[])
            .filter((p: any) => p.kind === "text")
            .map((p: any) => p.text)
            .join("");
          console.log(`[agent] ${text}`);
          break;
        }
      }
    }
  } else {
    // Non-streaming fallback
    console.log(`Sending task: fetch ${TARGET_URL}\n`);
    const result = await client.sendMessage(params);

    if ("status" in result) {
      const task = result as Task;
      console.log(`Task ${task.id}: ${task.status.state}`);
      if (task.artifacts) {
        for (const artifact of task.artifacts) {
          console.log(`\n--- Artifact: ${artifact.name || artifact.artifactId} ---`);
          for (const part of artifact.parts) {
            if (part.kind === "text") {
              console.log((part as any).text);
            } else if (part.kind === "data") {
              console.log(JSON.stringify((part as any).data, null, 2));
            }
          }
        }
      }
    } else {
      const msg = result as Message;
      const text = (msg.parts as any[])
        .filter((p: any) => p.kind === "text")
        .map((p: any) => p.text)
        .join("");
      console.log(`Response: ${text}`);
    }
  }

  console.log(`\n--- Done ---\n`);
}

main().catch(console.error);
