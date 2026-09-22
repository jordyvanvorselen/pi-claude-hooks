import type { HookJsonOutput, HookRunResult } from "./types.ts";

export function parseHookJson(stdout: string): HookJsonOutput | undefined {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as HookJsonOutput;
	} catch {}
	return undefined;
}

const BLOCKABLE_EVENTS = new Set(["PreToolUse", "UserPromptSubmit", "Stop", "PreCompact"]);
const FEEDBACK_EVENTS = new Set(["PostToolUse", "PostToolUseFailure"]);
const STDOUT_CONTEXT_EVENTS = new Set(["UserPromptSubmit", "SessionStart"]);

export interface HookOutcome {
	results: HookRunResult[];
	blocked: boolean;
	blockReason: string | undefined;
	ask: boolean;
	askReason: string | undefined;
	allow: boolean;
	stop: boolean;
	stopReason: string | undefined;
	context: string[];
	feedback: string[];
	systemMessages: string[];
	errors: string[];
	updatedInputs: Record<string, unknown>[];
}

export function interpretResults(event: string, results: HookRunResult[]): HookOutcome {
	const outcome: HookOutcome = {
		results,
		blocked: false,
		blockReason: undefined,
		ask: false,
		askReason: undefined,
		allow: false,
		stop: false,
		stopReason: undefined,
		context: [],
		feedback: [],
		systemMessages: [],
		errors: [],
		updatedInputs: [],
	};

	const block = (reason: string | undefined) => {
		if (!outcome.blocked) {
			outcome.blocked = true;
			outcome.blockReason = reason?.trim() || undefined;
		}
	};

	for (const r of results) {
		const label = describeHook(r);
		const stderr = r.stderr.trim();

		if (r.timedOut) {
			outcome.errors.push(`${label} timed out after ${Math.round(r.hook.timeoutMs / 1000)}s`);
			continue;
		}

		if (r.code === 2) {
			if (BLOCKABLE_EVENTS.has(event)) block(stderr || "Blocked by hook");
			else if (FEEDBACK_EVENTS.has(event)) outcome.feedback.push(stderr || "Hook reported a problem");
			else outcome.errors.push(stderr || `${label} exited with code 2`);
		} else if (r.code !== 0) {
			outcome.errors.push(`${label} exited with code ${r.code}${stderr ? `: ${stderr}` : ""}`);
		}

		if (r.json) {
			applyJson(event, r.json, outcome, block);
		} else if (r.code === 0 && STDOUT_CONTEXT_EVENTS.has(event) && r.stdout.trim()) {
			outcome.context.push(r.stdout.trim());
		}
	}

	return outcome;
}

function applyJson(event: string, json: import("./types.ts").HookJsonOutput, outcome: HookOutcome, block: (reason?: string) => void) {
	if (typeof json.systemMessage === "string" && json.systemMessage) outcome.systemMessages.push(json.systemMessage);

	if (json.continue === false) {
		outcome.stop = true;
		outcome.stopReason = outcome.stopReason ?? json.stopReason;
		if (BLOCKABLE_EVENTS.has(event)) block(json.stopReason ?? "Stopped by hook");
	}

	if (json.decision === "block" || json.decision === "deny") {
		if (FEEDBACK_EVENTS.has(event)) outcome.feedback.push(json.reason?.trim() || "Blocked by hook");
		else if (BLOCKABLE_EVENTS.has(event)) block(json.reason || "Blocked by hook");
	} else if (json.decision === "approve" || json.decision === "allow") {
		outcome.allow = true;
	}

	const hso = json.hookSpecificOutput;
	if (hso && typeof hso === "object") {
		if (hso.permissionDecision === "deny") {
			block(hso.permissionDecisionReason || "Denied by hook");
		} else if (hso.permissionDecision === "ask" || hso.permissionDecision === "defer") {
			outcome.ask = true;
			outcome.askReason = outcome.askReason ?? hso.permissionDecisionReason;
		} else if (hso.permissionDecision === "allow") {
			outcome.allow = true;
		}
		if (hso.updatedInput && typeof hso.updatedInput === "object") outcome.updatedInputs.push(hso.updatedInput);
		if (typeof hso.additionalContext === "string" && hso.additionalContext) outcome.context.push(hso.additionalContext);
	}
}

export function describeHook(r: HookRunResult): string {
	const cmd = r.hook.command.length > 60 ? `${r.hook.command.slice(0, 57)}...` : r.hook.command;
	return `${r.hook.event} hook [${cmd}]`;
}
