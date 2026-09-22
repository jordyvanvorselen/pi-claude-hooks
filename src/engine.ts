import { matcherMatches } from "./matcher.ts";
import { type HookOutcome, interpretResults, parseHookJson } from "./output.ts";
import { runCommandHook } from "./runner.ts";
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

	summary(): string[] {
		const lines: string[] = [];
		if (this.loaded.sources.length === 0) {
			lines.push("No Claude Code hook files found.");
		} else {
			lines.push("Sources:");
			for (const s of this.loaded.sources) lines.push(`  ${s}`);
		}
		const byEvent = new Map<string, LoadedHook[]>();
		for (const h of this.loaded.hooks) {
			const list = byEvent.get(h.event) ?? [];
			list.push(h);
			byEvent.set(h.event, list);
		}
		lines.push(`Hooks: ${this.loaded.hooks.length}`);
		for (const [event, hooks] of byEvent) {
			lines.push(`  ${event} (${hooks.length})`);
			for (const h of hooks) {
				const matcher = h.matcher === undefined ? "*" : h.matcher || "*";
				const cmd = h.command.length > 70 ? `${h.command.slice(0, 67)}...` : h.command;
				lines.push(`    [${matcher}] ${cmd}`);
			}
		}
		for (const w of this.loaded.warnings) lines.push(`Warning: ${w}`);
		return lines;
	}
}
