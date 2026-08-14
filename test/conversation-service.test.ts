import { describe, expect, it } from "vitest";
import {
	ConversationService,
	extractAssistantText,
	PiConversationError,
	type PiBackend,
	type PiSessionEvent,
	type PiSessionHandle,
} from "../src/conversation-service.js";

class FakeBackend implements PiBackend {
	private nextId = 1;
	readonly knownSessions = new Set<string>();
	activePrompts = 0;
	maxActivePrompts = 0;
	delayMs = 0;

	async open(sessionId?: string): Promise<PiSessionHandle> {
		const id = sessionId ?? `session-${this.nextId++}`;
		if (sessionId && !this.knownSessions.has(sessionId)) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		this.knownSessions.add(id);

		const listeners = new Set<(event: PiSessionEvent) => void>();
		return {
			sessionId: id,
			prompt: async (message) => {
				this.activePrompts += 1;
				this.maxActivePrompts = Math.max(
					this.maxActivePrompts,
					this.activePrompts,
				);
				if (this.delayMs) {
					await new Promise((resolve) => setTimeout(resolve, this.delayMs));
				}
				for (const listener of listeners) {
					listener({
						type: "message_end",
						message: {
							role: "assistant",
							content: [{ type: "text", text: `reply:${message}` }],
							stopReason: "stop",
						},
					});
				}
				this.activePrompts -= 1;
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			abort: async () => undefined,
			isResumable: () => true,
			dispose: () => undefined,
		};
	}
}

describe("extractAssistantText", () => {
	it("returns only text content", () => {
		expect(
			extractAssistantText({
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "hello " },
					{ type: "toolCall", name: "read" },
					{ type: "text", text: "world" },
				],
			}),
		).toBe("hello world");
	});
});

describe("ConversationService", () => {
	it("creates a session and resumes it by returned ID", async () => {
		const backend = new FakeBackend();
		const service = new ConversationService(backend);

		const first = await service.send("first");
		const second = await service.send("second", first.sessionId);

		expect(first).toEqual({
			reply: "reply:first",
			sessionId: "session-1",
		});
		expect(second).toEqual({
			reply: "reply:second",
			sessionId: "session-1",
		});
	});

	it("serializes concurrent messages sent to the same session", async () => {
		const backend = new FakeBackend();
		backend.knownSessions.add("shared-session");
		backend.delayMs = 10;
		const service = new ConversationService(backend);

		await Promise.all([
			service.send("one", "shared-session"),
			service.send("two", "shared-session"),
		]);

		expect(backend.maxActivePrompts).toBe(1);
	});

	it("returns the useful session ID when Pi reports an error", async () => {
		let listener: ((event: PiSessionEvent) => void) | undefined;
		const backend: PiBackend = {
			open: async () => ({
				sessionId: "failed-session",
				prompt: async () => {
					listener?.({
						type: "message_end",
						message: {
							role: "assistant",
							content: [],
							stopReason: "error",
							errorMessage: "provider unavailable",
						},
					});
				},
				subscribe: (nextListener) => {
					listener = nextListener;
					return () => undefined;
				},
				abort: async () => undefined,
				isResumable: () => true,
				dispose: () => undefined,
			}),
		};
		const service = new ConversationService(backend);

		await expect(service.send("hello")).rejects.toMatchObject({
			name: PiConversationError.name,
			message: "provider unavailable",
			sessionId: "failed-session",
		});
	});
});
