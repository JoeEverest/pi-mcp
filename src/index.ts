#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { ConversationService } from "./conversation-service.js";
import { PiSdkBackend } from "./pi-backend.js";
import { createPiMcpServer } from "./server.js";

type ThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

const THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

function getThinkingLevel(): ThinkingLevel | undefined {
	const value = process.env.PI_MCP_THINKING;
	if (!value) return undefined;
	if (!THINKING_LEVELS.has(value as ThinkingLevel)) {
		throw new Error(
			`Invalid PI_MCP_THINKING '${value}'. Expected one of: ${[...THINKING_LEVELS].join(", ")}.`,
		);
	}
	return value as ThinkingLevel;
}

async function main(): Promise<void> {
	const cwd = process.env.PI_MCP_CWD || process.cwd();
	const backend = new PiSdkBackend({
		cwd,
		sessionDir: process.env.PI_MCP_SESSION_DIR,
		provider: process.env.PI_MCP_PROVIDER,
		model: process.env.PI_MCP_MODEL,
		thinkingLevel: getThinkingLevel(),
	});
	const server = createPiMcpServer(new ConversationService(backend));

	await server.connect(new StdioServerTransport());
	console.error(`pi-mcp listening on stdio (cwd: ${cwd})`);
}

main().catch((error) => {
	console.error("pi-mcp failed to start:", error);
	process.exitCode = 1;
});
