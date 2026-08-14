import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
	PiConversationError,
	type ConversationReply,
	type ConversationService,
} from "./conversation-service.js";

export interface MessageService {
	send(
		message: string,
		sessionId?: string,
		signal?: AbortSignal,
	): Promise<ConversationReply>;
}

function errorPayload(error: unknown): Record<string, string> {
	if (error instanceof PiConversationError) {
		return {
			error: error.message,
			...(error.sessionId ? { sessionId: error.sessionId } : {}),
		};
	}

	return {
		error: error instanceof Error ? error.message : String(error),
	};
}

export function createPiMcpServer(
	service: MessageService | ConversationService,
): McpServer {
	const server = new McpServer({ name: "pi-mcp", version: "0.1.0" });

	server.registerTool(
		"pi_message",
		{
			title: "Message Pi",
			description:
				"Send a message to the Pi coding agent and wait for its final reply. Omit sessionId to start a new persistent conversation. Pass the exact returned sessionId on a later call to continue that same conversation. Pi can read, run commands, and edit files in the server's configured working directory.",
			inputSchema: {
				message: z
					.string()
					.trim()
					.min(1)
					.describe("The message to send to Pi."),
				sessionId: z
					.string()
					.trim()
					.min(1)
					.optional()
					.describe(
						"The sessionId from a previous pi_message result. Omit to start a new conversation.",
					),
			},
			outputSchema: {
				reply: z.string(),
				sessionId: z.string(),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ message, sessionId }, extra) => {
			try {
				const result = await service.send(message, sessionId, extra.signal);
				return {
					content: [{ type: "text", text: JSON.stringify(result) }],
					structuredContent: result,
				};
			} catch (error) {
				return {
					isError: true,
					content: [
						{ type: "text", text: JSON.stringify(errorPayload(error)) },
					],
				};
			}
		},
	);

	return server;
}
