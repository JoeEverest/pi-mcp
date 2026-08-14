import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { PiConversationError } from "../src/conversation-service.js";
import { createPiMcpServer, type MessageService } from "../src/server.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect(service: MessageService): Promise<Client> {
	const server = createPiMcpServer(service);
	const client = new Client({ name: "test-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);
	closers.push(() => client.close(), () => server.close());
	return client;
}

describe("pi MCP server", () => {
	it("exposes exactly one tool with structured reply and session ID", async () => {
		const service: MessageService = {
			send: async (message, sessionId) => ({
				reply: `Pi heard: ${message}`,
				sessionId: sessionId ?? "new-session",
			}),
		};
		const client = await connect(service);

		const tools = await client.listTools();
		const result = await client.callTool({
			name: "pi_message",
			arguments: { message: "hello" },
		});

		expect(tools.tools.map((tool) => tool.name)).toEqual(["pi_message"]);
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual({
			reply: "Pi heard: hello",
			sessionId: "new-session",
		});
	});

	it("returns MCP tool errors as JSON and preserves a resumable session ID", async () => {
		const service: MessageService = {
			send: async () => {
				throw new PiConversationError("model failed", "resume-me");
			},
		};
		const client = await connect(service);

		const result = await client.callTool({
			name: "pi_message",
			arguments: { message: "hello" },
		});

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{
				type: "text",
				text: JSON.stringify({
					error: "model failed",
					sessionId: "resume-me",
				}),
			},
		]);
	});
});
