import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadClaudeHooks, loadOptions } from "../src/config.ts";
import { ClaudeHooksEngine, type RunContext } from "../src/engine.ts";
import type { HookOutcome } from "../src/output.ts";
import { claudeToolName, fromClaudeToolInput, replaceInputInPlace, toClaudeToolInput, toolNameCandidates } from "../src/tools.ts";
import type { HookRunResult, LoadedHook } from "../src/types.ts";

const CONTEXT_MESSAGE_TYPE = "claude-hooks-context";

export default function claudeHooks(pi: ExtensionAPI) {
	let engine: ClaudeHooksEngine | undefined;
	let projectDir = process.cwd();
	let warnedUntrusted = false;
	let stopHookActive = false;
	let pendingPromptContext: string[] = [];
	const pendingToolContext = new Map<string, string[]>();

	function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info") {
		if (ctx.hasUI) ctx.ui.notify(message, type);
		else process.stderr.write(`[claude-hooks] ${message}\n`);
	}

	function reload(ctx: ExtensionContext, announce: boolean): ClaudeHooksEngine {
		projectDir = ctx.cwd;
		const options = loadOptions(projectDir);
		const trusted = ctx.isProjectTrusted();
		const loaded = options.enabled
			? loadClaudeHooks({ projectDir, includeProject: trusted }, options)
			: { hooks: [], sources: [], warnings: [] };
		engine = new ClaudeHooksEngine(loaded, options);
		if (!trusted && !warnedUntrusted && options.enabled) {
			warnedUntrusted = true;
			notify(ctx, "Project is not trusted, only ~/.claude/settings.json hooks are loaded", "warning");
		}
		for (const warning of loaded.warnings) notify(ctx, warning, "warning");
		if (announce || options.verbose) {
			notify(ctx, `Loaded ${loaded.hooks.length} Claude Code hook(s) from ${loaded.sources.length} file(s)`);
		}
		return engine;
	}

	function getEngine(ctx: ExtensionContext): ClaudeHooksEngine {
		return engine ?? reload(ctx, false);
	}

	function basePayload(ctx: ExtensionContext, event: string): Record<string, unknown> {
		return {
			session_id: ctx.sessionManager.getSessionId(),
			transcript_path: ctx.sessionManager.getSessionFile() ?? "",
			cwd: ctx.cwd,
			hook_event_name: event,
			permission_mode: "default",
		};
	}

	function buildEnv(ctx: ExtensionContext): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PI_CLAUDE_HOOKS: "1" };
		env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (sessionFile) env.PI_SESSION_FILE = sessionFile;
		if (ctx.model) {
			env.PI_PROVIDER = ctx.model.provider;
			env.PI_MODEL = ctx.model.id;
		}
		if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
		return env;
	}

	function runContext(ctx: ExtensionContext, eng: ClaudeHooksEngine): RunContext {
		const verbose = eng.options.verbose;
		return {
			cwd: ctx.cwd,
			env: buildEnv(ctx),
			signal: ctx.signal,
			onStart: verbose ? (hook: LoadedHook) => notify(ctx, `Running ${hook.event} hook: ${shorten(hook.command)}`) : undefined,
			onResult: verbose
				? (r: HookRunResult) => notify(ctx, `${r.hook.event} hook exited ${r.code}${r.stderr.trim() ? `: ${r.stderr.trim()}` : ""}`)
				: undefined,
		};
	}

	function reportCommon(ctx: ExtensionContext, outcome: HookOutcome) {
		for (const m of outcome.systemMessages) notify(ctx, m, "warning");
		for (const e of outcome.errors) notify(ctx, e, "error");
	}

	async function runEvent(
		ctx: ExtensionContext,
		event: string,
		candidates: string[] | undefined,
		extra: Record<string, unknown>,
	): Promise<HookOutcome | undefined> {
		const eng = getEngine(ctx);
		if (eng.hooksFor(event, candidates).length === 0) return undefined;
		const outcome = await eng.run(event, candidates, { ...basePayload(ctx, event), ...extra }, runContext(ctx, eng));
		reportCommon(ctx, outcome);
		return outcome;
	}

	pi.on("session_start", async (event, ctx) => {
		const eng = reload(ctx, false);
		pendingPromptContext = [];
		pendingToolContext.clear();
		stopHookActive = false;
		const source = mapSessionStartSource(event.reason);
		if (eng.hooksFor("SessionStart", [source]).length === 0) return;
		const outcome = await runEvent(ctx, "SessionStart", [source], { source, model: ctx.model?.id });
		if (!outcome) return;
		pendingPromptContext.push(...outcome.context);
	});

	pi.on("session_shutdown", async (event, ctx) => {
		const reason = mapSessionEndReason(event.reason);
		await runEvent(ctx, "SessionEnd", [reason], { reason });
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		const outcome = await runEvent(ctx, "UserPromptSubmit", undefined, { prompt: event.text });
		if (!outcome) return { action: "continue" };
		if (outcome.blocked) {
			notify(ctx, `Prompt blocked by hook${outcome.blockReason ? `: ${outcome.blockReason}` : ""}`, "warning");
			return { action: "handled" };
		}
		if (outcome.context.length === 0) return { action: "continue" };
		if (event.streamingBehavior) {
			return { action: "transform", text: `${event.text}\n\n${outcome.context.join("\n\n")}`, images: event.images };
		}
		pendingPromptContext.push(...outcome.context);
		return { action: "continue" };
	});

	pi.on("before_agent_start", async () => {
		if (pendingPromptContext.length === 0) return;
		const content = pendingPromptContext.join("\n\n");
		pendingPromptContext = [];
		return { message: { customType: CONTEXT_MESSAGE_TYPE, content, display: false } };
	});

	pi.on("tool_call", async (event, ctx) => {
		const candidates = toolNameCandidates(event.toolName);
		const input = event.input as Record<string, unknown>;
		const outcome = await runEvent(ctx, "PreToolUse", candidates, {
			tool_name: claudeToolName(event.toolName),
			tool_input: toClaudeToolInput(event.toolName, input),
			tool_use_id: event.toolCallId,
			pi_tool_name: event.toolName,
		});
		if (!outcome) return;

		if (outcome.blocked) {
			const reason = outcome.blockReason ?? "Blocked by Claude Code hook";
			notify(ctx, `Blocked ${event.toolName}: ${reason}`, "warning");
			return { block: true, reason, terminate: outcome.stop };
		}

		if (outcome.ask) {
			const reason = outcome.askReason ?? "A hook asked for confirmation";
			if (!ctx.hasUI) return { block: true, reason: `${reason} (no UI available to confirm)` };
			const ok = await ctx.ui.confirm(`Allow ${event.toolName}?`, `${reason}\n\n${summarizeInput(input)}`);
			if (!ok) return { block: true, reason: `Denied by user: ${reason}` };
		}

		for (const updated of outcome.updatedInputs) {
			const mapped = fromClaudeToolInput(event.toolName, input, updated);
			for (const w of mapped.warnings) notify(ctx, w, "warning");
			replaceInputInPlace(input, mapped.input);
		}

		if (outcome.context.length > 0) pendingToolContext.set(event.toolCallId, outcome.context);
		return;
	});

	pi.on("tool_result", async (event, ctx) => {
		const candidates = toolNameCandidates(event.toolName);
		const hookEvent = event.isError ? "PostToolUseFailure" : "PostToolUse";
		const input = event.input as Record<string, unknown>;
		const outputText = event.content
			.map((c) => (c.type === "text" ? c.text : "[image]"))
			.join("\n");
		const preContext = pendingToolContext.get(event.toolCallId) ?? [];
		pendingToolContext.delete(event.toolCallId);

		const outcome = await runEvent(ctx, hookEvent, candidates, {
			tool_name: claudeToolName(event.toolName),
			tool_input: toClaudeToolInput(event.toolName, input),
			tool_use_id: event.toolCallId,
			pi_tool_name: event.toolName,
			...(event.isError
				? { error: outputText, is_interrupt: false }
				: { tool_response: { output: outputText, details: event.details, is_error: false } }),
		});

		const feedback = [...preContext, ...(outcome?.feedback ?? []), ...(outcome?.context ?? [])];
		if (outcome?.stop) {
			notify(ctx, `Hook stopped the agent${outcome.stopReason ? `: ${outcome.stopReason}` : ""}`, "warning");
			ctx.abort();
		}
		if (feedback.length === 0) return;
		for (const f of outcome?.feedback ?? []) notify(ctx, `${hookEvent} hook: ${shorten(f, 200)}`, "warning");
		return {
			content: [...event.content, { type: "text", text: `\n\n[${hookEvent} hook feedback]\n${feedback.join("\n\n")}` }],
		};
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed") return;
		const outcome = await runEvent(ctx, "Stop", undefined, {
			stop_hook_active: stopHookActive,
			last_assistant_message: lastAssistantText(event.context.contextMessages),
		});
		if (!outcome) return;
		if (outcome.blocked && !outcome.stop) {
			stopHookActive = true;
			const reason = outcome.blockReason ?? "A Stop hook asked to continue";
			notify(ctx, `Stop hook: ${shorten(reason, 200)}`, "warning");
			return {
				entries: [
					...event.entries,
					{ type: "custom_message", customType: CONTEXT_MESSAGE_TYPE, content: reason, display: false },
				],
				continue: true,
			};
		}
		stopHookActive = false;
		return;
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const trigger = event.reason === "manual" ? "manual" : "auto";
		const outcome = await runEvent(ctx, "PreCompact", [trigger], { trigger, custom_instructions: event.customInstructions ?? "" });
		if (!outcome) return;
		if (outcome.blocked) {
			notify(ctx, `Compaction blocked by hook${outcome.blockReason ? `: ${outcome.blockReason}` : ""}`, "warning");
			return { cancel: true };
		}
		return;
	});

	pi.on("session_compact", async (event, ctx) => {
		const trigger = event.reason === "manual" ? "manual" : "auto";
		await runEvent(ctx, "PostCompact", [trigger], { trigger, compaction_summary: event.compactionEntry?.summary ?? "" });
	});

	pi.registerCommand("claude-hooks", {
		description: "List Claude Code hooks loaded from .claude/",
		handler: async (_args, ctx) => {
			const eng = getEngine(ctx);
			notify(ctx, eng.summary().join("\n"));
		},
	});

	pi.registerCommand("claude-hooks-reload", {
		description: "Reload Claude Code hooks from .claude/",
		handler: async (_args, ctx) => {
			reload(ctx, true);
		},
	});

	pi.registerCommand("claude-hooks-verbose", {
		description: "Toggle verbose logging of every Claude Code hook run",
		handler: async (_args, ctx) => {
			const eng = getEngine(ctx);
			eng.options.verbose = !eng.options.verbose;
			notify(ctx, `Claude hooks verbose logging ${eng.options.verbose ? "on" : "off"}`);
		},
	});
}

function mapSessionStartSource(reason: string): string {
	switch (reason) {
		case "resume":
			return "resume";
		case "new":
			return "clear";
		case "fork":
			return "fork";
		default:
			return "startup";
	}
}

function mapSessionEndReason(reason: string): string {
	switch (reason) {
		case "new":
			return "clear";
		case "resume":
			return "resume";
		default:
			return "other";
	}
}

function lastAssistantText(messages: readonly unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; content?: unknown };
		if (m.role !== "assistant") continue;
		if (typeof m.content === "string") return m.content;
		if (Array.isArray(m.content)) {
			return m.content
				.filter((c): c is { type: "text"; text: string } => !!c && typeof c === "object" && (c as { type?: string }).type === "text")
				.map((c) => c.text)
				.join("\n");
		}
	}
	return "";
}

function summarizeInput(input: Record<string, unknown>): string {
	const text = JSON.stringify(input);
	return shorten(text, 300);
}

function shorten(text: string, max = 80): string {
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
