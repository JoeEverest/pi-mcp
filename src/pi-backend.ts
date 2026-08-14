import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import type {
	PiBackend,
	PiSessionEvent,
	PiSessionHandle,
} from "./conversation-service.js";

const SESSION_ID_PATTERN =
	/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

type ThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export interface PiBackendOptions {
	cwd: string;
	sessionDir?: string;
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

export function assertSessionId(sessionId: string): void {
	if (sessionId.length > 255 || !SESSION_ID_PATTERN.test(sessionId)) {
		throw new Error(
			"Invalid sessionId. Use the exact sessionId returned by pi_message.",
		);
	}
}

export class PiSdkBackend implements PiBackend {
	private readonly cwd: string;
	private readonly sessionDir?: string;
	private readonly modelRuntimePromise: Promise<ModelRuntime>;

	constructor(private readonly options: PiBackendOptions) {
		if ((options.provider && !options.model) || (!options.provider && options.model)) {
			throw new Error(
				"PI_MCP_PROVIDER and PI_MCP_MODEL must be configured together.",
			);
		}

		this.cwd = resolve(options.cwd);
		this.sessionDir = options.sessionDir
			? resolve(options.sessionDir)
			: undefined;
		this.modelRuntimePromise = ModelRuntime.create();
	}

	async open(sessionId?: string): Promise<PiSessionHandle> {
		const sessionManager = sessionId
			? await this.openExistingSession(sessionId)
			: SessionManager.create(this.cwd, this.sessionDir);
		const modelRuntime = await this.modelRuntimePromise;
		const model =
			this.options.provider && this.options.model
				? modelRuntime.getModel(this.options.provider, this.options.model)
				: undefined;

		if (this.options.provider && this.options.model && !model) {
			throw new Error(
				`Unknown Pi model: ${this.options.provider}/${this.options.model}`,
			);
		}

		const { session } = await createAgentSession({
			cwd: this.cwd,
			modelRuntime,
			model,
			thinkingLevel: this.options.thinkingLevel,
			sessionManager,
		});

		return {
			sessionId: session.sessionId,
			prompt: (message) => session.prompt(message),
			subscribe: (listener) =>
				session.subscribe((event) => listener(event as PiSessionEvent)),
			abort: () => session.abort(),
			isResumable: () =>
				typeof session.sessionFile === "string" &&
				existsSync(session.sessionFile),
			dispose: () => session.dispose(),
		};
	}

	private async openExistingSession(sessionId: string): Promise<SessionManager> {
		assertSessionId(sessionId);
		const sessions = await SessionManager.list(this.cwd, this.sessionDir);
		const match = sessions.find((session) => session.id === sessionId);

		if (!match) {
			throw new Error(
				`Pi session '${sessionId}' was not found for ${this.cwd}.`,
			);
		}

		return SessionManager.open(match.path, this.sessionDir, this.cwd);
	}
}
