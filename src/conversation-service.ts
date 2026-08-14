export interface PiSessionEvent {
	type: string;
	message?: unknown;
}

export interface PiSessionHandle {
	readonly sessionId: string;
	prompt(message: string): Promise<void>;
	subscribe(listener: (event: PiSessionEvent) => void): () => void;
	abort(): Promise<void>;
	isResumable(): boolean;
	dispose(): void;
}

export interface PiBackend {
	open(sessionId?: string): Promise<PiSessionHandle>;
}

export type ConversationReply = {
	reply: string;
	sessionId: string;
} & Record<string, unknown>;

export class PiConversationError extends Error {
	constructor(
		message: string,
		readonly sessionId?: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "PiConversationError";
	}
}

interface AssistantMessage {
	role: "assistant";
	content: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"role" in value &&
		value.role === "assistant" &&
		"content" in value
	);
}

export function extractAssistantText(message: AssistantMessage): string {
	if (!Array.isArray(message.content)) return "";

	return message.content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				part.type === "text" &&
				"text" in part &&
				typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("")
		.trim();
}

class KeyedQueue {
	private readonly tails = new Map<string, Promise<void>>();

	async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(() => gate);
		this.tails.set(key, tail);

		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (this.tails.get(key) === tail) this.tails.delete(key);
		}
	}
}

export class ConversationService {
	private readonly queue = new KeyedQueue();
	private nextNewSession = 0;

	constructor(private readonly backend: PiBackend) {}

	async send(
		message: string,
		sessionId?: string,
		signal?: AbortSignal,
	): Promise<ConversationReply> {
		const queueKey = sessionId ?? `new:${this.nextNewSession++}`;
		return this.queue.run(queueKey, () =>
			this.sendUnlocked(message, sessionId, signal),
		);
	}

	private async sendUnlocked(
		message: string,
		sessionId?: string,
		signal?: AbortSignal,
	): Promise<ConversationReply> {
		if (signal?.aborted) {
			throw new PiConversationError("The MCP request was cancelled.", sessionId);
		}

		let activeSession: PiSessionHandle | undefined;
		let unsubscribe: (() => void) | undefined;
		let lastAssistantMessage: AssistantMessage | undefined;

		try {
			activeSession = await this.backend.open(sessionId);
			unsubscribe = activeSession.subscribe((event) => {
				if (event.type === "message_end" && isAssistantMessage(event.message)) {
					lastAssistantMessage = event.message;
				}
			});

			const abort = () => {
				void activeSession?.abort().catch(() => undefined);
			};
			signal?.addEventListener("abort", abort, { once: true });

			try {
				await activeSession.prompt(message);
			} finally {
				signal?.removeEventListener("abort", abort);
			}

			if (!lastAssistantMessage) {
				throw new PiConversationError(
					"Pi completed without producing an assistant reply.",
					activeSession.sessionId,
				);
			}

			const reply = extractAssistantText(lastAssistantMessage);
			if (lastAssistantMessage.stopReason === "error") {
				const detail =
					typeof lastAssistantMessage.errorMessage === "string"
						? lastAssistantMessage.errorMessage
						: reply || "Pi's model request failed.";
				throw new PiConversationError(detail, activeSession.sessionId);
			}

			if (!reply) {
				throw new PiConversationError(
					"Pi's final assistant message contained no text.",
					activeSession.sessionId,
				);
			}

			return { reply, sessionId: activeSession.sessionId };
		} catch (error) {
			const resumableSessionId =
				sessionId ??
				(activeSession?.isResumable() ? activeSession.sessionId : undefined);
			if (error instanceof PiConversationError) {
				throw new PiConversationError(error.message, resumableSessionId, {
					cause: error,
				});
			}

			throw new PiConversationError(
				error instanceof Error ? error.message : String(error),
				resumableSessionId,
				{ cause: error },
			);
		} finally {
			unsubscribe?.();
			activeSession?.dispose();
		}
	}
}
