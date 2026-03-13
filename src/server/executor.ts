/**
 * Agent Executor — the brain of the A2A agent.
 *
 * Receives tasks from other agents via the A2A protocol,
 * extracts the target URL, makes an x402-paid fetch,
 * and streams the result back as A2A artifacts.
 */

import type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "@a2a-js/sdk/server";
import type { Part, TextPart, DataPart } from "@a2a-js/sdk";
import { X402Client, type X402FetchResult } from "./x402.js";

interface FetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export class PaymentAgentExecutor implements AgentExecutor {
  constructor(private x402: X402Client) {}

  async execute(
    context: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const { taskId, contextId, userMessage } = context;

    // Parse the user's request into a fetch configuration
    let fetchReq: FetchRequest;
    try {
      fetchReq = this.parseRequest(userMessage.parts as Part[]);
    } catch (err: any) {
      eventBus.publish({
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "failed",
          message: {
            kind: "message",
            messageId: crypto.randomUUID(),
            role: "agent",
            parts: [{ kind: "text", text: `Invalid request: ${err.message}` }],
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      });
      return;
    }

    // Signal that we're working
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "working",
        message: {
          kind: "message",
          messageId: crypto.randomUUID(),
          role: "agent",
          parts: [
            {
              kind: "text",
              text: `Fetching ${fetchReq.url}${fetchReq.method && fetchReq.method !== "GET" ? ` (${fetchReq.method})` : ""}...`,
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    });

    // Make the x402-paid fetch
    let result: X402FetchResult;
    try {
      result = await this.x402.paidFetch(fetchReq.url, {
        method: fetchReq.method || "GET",
        headers: fetchReq.headers,
        body: fetchReq.body,
      });
    } catch (err: any) {
      eventBus.publish({
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "failed",
          message: {
            kind: "message",
            messageId: crypto.randomUUID(),
            role: "agent",
            parts: [
              { kind: "text", text: `Payment/fetch failed: ${err.message}` },
            ],
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      });
      return;
    }

    // Read response body
    const responseBody = await result.response.text();
    const contentType =
      result.response.headers.get("content-type") || "text/plain";

    // Build the artifact parts
    const artifactParts: Part[] = [];

    // If JSON, send as structured data; otherwise as text
    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(responseBody);
        artifactParts.push({
          kind: "data",
          mediaType: "application/json",
          data: parsed,
        } as DataPart);
      } catch {
        artifactParts.push({ kind: "text", text: responseBody } as TextPart);
      }
    } else {
      artifactParts.push({ kind: "text", text: responseBody } as TextPart);
    }

    // Emit the artifact
    eventBus.publish({
      kind: "artifact-update",
      taskId,
      contextId,
      artifact: {
        artifactId: "response",
        name: `Response from ${fetchReq.url}`,
        parts: artifactParts,
        metadata: {
          httpStatus: result.response.status,
          paid: result.paid,
          ...(result.amount && { amountPaid: result.amount }),
          ...(result.txHash && { txHash: result.txHash }),
        },
      },
      lastChunk: true,
    });

    // Done
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
      },
      final: true,
    });
  }

  async cancelTask(
    taskId: string,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId: "",
      status: {
        state: "canceled",
        timestamp: new Date().toISOString(),
      },
      final: true,
    });
  }

  /**
   * Parse the incoming A2A message parts into a fetch request.
   * Accepts either:
   * - A text part containing a URL
   * - A data part with { url, method?, headers?, body? }
   */
  private parseRequest(parts: Part[]): FetchRequest {
    for (const part of parts) {
      if (part.kind === "data" && part.data) {
        const d = part.data as Record<string, unknown>;
        if (typeof d.url === "string") {
          return {
            url: d.url,
            method: (d.method as string) || "GET",
            headers: (d.headers as Record<string, string>) || undefined,
            body: d.body != null ? String(d.body) : undefined,
          };
        }
      }

      if (part.kind === "text") {
        const text = (part as TextPart).text.trim();
        // Extract URL from text (first thing that looks like a URL)
        const urlMatch = text.match(/https?:\/\/\S+/);
        if (urlMatch) {
          return { url: urlMatch[0] };
        }

        // Try parsing as JSON
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed.url === "string") {
            return {
              url: parsed.url,
              method: parsed.method || "GET",
              headers: parsed.headers,
              body:
                parsed.body != null ? JSON.stringify(parsed.body) : undefined,
            };
          }
        } catch {}
      }
    }

    throw new Error(
      'No URL found in message. Send a URL as text or a JSON object with { "url": "..." }'
    );
  }
}
