import { matcherMatches } from "./matcher.ts";
import { type HookOutcome, interpretResults, parseHookJson } from "./output.ts";
import { runCommandHook } from "./runner.ts";
import { buildSummary, formatForCommand, type HooksSummary } from "./summary.ts";
import type { ClaudeHooksOptions, HookRunResult, LoadResult, LoadedHook } from "./types.ts";

export interface RunContext {
	cwd: string;
	env: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	onStart?: (hook: LoadedHook) => void;
	onResult?: (result: HookRunResult) => void;
}

export class ClaudeHooksEngine {
	readonly loaded: LoadResult;
	readonly options: ClaudeHooksOptions;

	constructor(loaded: LoadResult, options: ClaudeHooksOptions) {
		this.loaded = loaded;
		this.options = options;
	}

	get hooks(): LoadedHook[] {
		return this.loaded.hooks;
	}

	hooksFor(event: string, candidates?: string[]): LoadedHook[] {
		return this.loaded.hooks.filter((h) => h.event === event && (candidates === undefined || matcherMatches(h.matcher, candidates)));
	}

	async run(event: string, candidates: string[] | undefined, payload: Record<string, unknown>, ctx: RunContext): Promise<HookOutcome> {
		const hooks = this.hooksFor(event, candidates);
		if (hooks.length === 0) return interpretResults(event, []);
		const stdin = JSON.stringify(payload);
		const results = await Promise.all(
			hooks.map(async (hook) => {
				ctx.onStart?.(hook);
				const run = await runCommandHook(hook.command, stdin, {
					cwd: ctx.cwd,
					env: ctx.env,
					timeoutMs: hook.timeoutMs,
					signal: ctx.signal,
					shell: this.options.shell,
				});
				const result: HookRunResult = { hook, ...run, json: parseHookJson(run.stdout) };
				ctx.onResult?.(result);
				return result;
			}),
		);
		return interpretResults(event, results);
	}

	summary(): HooksSummary {
		return buildSummary(this.loaded);
	}

	summaryText(): string {
		return formatForCommand(this.summary());
	}
}
