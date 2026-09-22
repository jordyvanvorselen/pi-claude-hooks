import { homedir } from "node:os";
import type { LoadResult, LoadedHook } from "./types.ts";

export const SUMMARY_ENTRY_TYPE = "claude-hooks-summary";

export interface SummaryHook {
	matcher: string;
	command: string;
}

export interface SummarySource {
	path: string;
	hooks: SummaryHook[];
}

export interface SummaryEvent {
	event: string;
	count: number;
}

export interface HooksSummary {
	events: SummaryEvent[];
	sources: SummarySource[];
	warnings: string[];
	total: number;
}

export function buildSummary(loaded: LoadResult, home = homedir()): HooksSummary {
	const counts = new Map<string, number>();
	const bySource = new Map<string, SummaryHook[]>();
	for (const source of loaded.sources) bySource.set(source, []);
	for (const h of loaded.hooks) {
		counts.set(h.event, (counts.get(h.event) ?? 0) + 1);
		const list = bySource.get(h.source) ?? [];
		list.push({ matcher: displayMatcher(h), command: shortenCommand(h.command) });
		bySource.set(h.source, list);
	}
	return {
		events: [...counts].map(([event, count]) => ({ event, count })),
		sources: [...bySource].map(([path, hooks]) => ({ path: displayPath(path, home), hooks })),
		warnings: loaded.warnings,
		total: loaded.hooks.length,
	};
}

export function compactEventList(summary: HooksSummary): string {
	return summary.events.map((e) => `${e.event} (${e.count})`).join(", ");
}

export interface SummaryStyle {
	header: (text: string) => string;
	source: (text: string) => string;
	dim: (text: string) => string;
	warning: (text: string) => string;
}

export const PLAIN_STYLE: SummaryStyle = {
	header: (t) => t,
	source: (t) => t,
	dim: (t) => t,
	warning: (t) => t,
};

export function formatCompact(summary: HooksSummary, style: SummaryStyle): string {
	return `${style.header("[Claude hooks]")}\n${style.dim(`  ${compactEventList(summary)}`)}`;
}

export function formatExpanded(summary: HooksSummary, style: SummaryStyle): string {
	const lines = [style.header("[Claude hooks]")];
	for (const source of summary.sources) {
		lines.push(`  ${style.source(source.path)}`);
		if (source.hooks.length === 0) lines.push(style.dim("    (no new hooks, duplicates of an earlier file or unsupported types)"));
		for (const h of source.hooks) lines.push(style.dim(`    ${h.matcher} ${h.command}`));
	}
	for (const w of summary.warnings) lines.push(style.warning(`  Warning: ${w}`));
	return lines.join("\n");
}

export function formatForCommand(summary: HooksSummary): string {
	if (summary.total === 0 && summary.sources.length === 0) return "No Claude Code hook files found.";
	return `${formatExpanded(summary, PLAIN_STYLE)}\n  Total: ${summary.total}`;
}

function displayMatcher(h: LoadedHook): string {
	const matcher = h.matcher === undefined || h.matcher.trim() === "" ? "*" : h.matcher;
	return `${h.event} [${matcher}]`;
}

function shortenCommand(command: string, max = 70): string {
	const single = command.replace(/\s+/g, " ").trim();
	return single.length > max ? `${single.slice(0, max - 3)}...` : single;
}

export function displayPath(path: string, home = homedir()): string {
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export interface AppendDecision {
	hasUI: boolean;
	mode: "compact" | "full" | "off";
	hookCount: number;
	existing: number;
}

export function shouldAppendSummary(d: AppendDecision): boolean {
	return d.hasUI && d.mode !== "off" && d.hookCount > 0 && d.existing === 0;
}
