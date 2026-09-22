import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type ClaudeHooksOptions,
	KNOWN_EVENT_NAMES,
	type LoadResult,
	type LoadedHook,
	type RawHookDefinition,
	type RawHookGroup,
} from "./types.ts";
import { invalidMatcher } from "./matcher.ts";

export const DEFAULT_OPTIONS: ClaudeHooksOptions = {
	enabled: true,
	loadUserSettings: true,
	extraFiles: ["*.json"],
	defaultTimeoutSeconds: 600,
	sessionEndTimeoutSeconds: 1.5,
	shell: undefined,
	verbose: false,
	startupSummary: "compact",
};

const SETTINGS_FILES = ["settings.json", "settings.local.json"];

export interface LoadPaths {
	home?: string;
	projectDir: string;
	includeProject: boolean;
}

export function loadOptions(projectDir: string, home = homedir()): ClaudeHooksOptions {
	const candidates = [join(home, ".pi", "agent", "claude-hooks.json"), join(projectDir, ".pi", "claude-hooks.json")];
	let options: ClaudeHooksOptions = { ...DEFAULT_OPTIONS };
	for (const file of candidates) {
		const parsed = readJson(file);
		if (parsed && typeof parsed === "object") {
			options = { ...options, ...pickOptions(parsed as Record<string, unknown>) };
		}
	}
	const envExtra = process.env.PI_CLAUDE_HOOKS_EXTRA_FILES;
	if (envExtra !== undefined) {
		options.extraFiles = envExtra
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (process.env.PI_CLAUDE_HOOKS_VERBOSE === "1") options.verbose = true;
	if (process.env.PI_CLAUDE_HOOKS_DISABLED === "1") options.enabled = false;
	return options;
}

function pickOptions(raw: Record<string, unknown>): Partial<ClaudeHooksOptions> {
	const out: Partial<ClaudeHooksOptions> = {};
	if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
	if (typeof raw.loadUserSettings === "boolean") out.loadUserSettings = raw.loadUserSettings;
	if (Array.isArray(raw.extraFiles)) out.extraFiles = raw.extraFiles.filter((s): s is string => typeof s === "string");
	if (typeof raw.defaultTimeoutSeconds === "number") out.defaultTimeoutSeconds = raw.defaultTimeoutSeconds;
	if (typeof raw.sessionEndTimeoutSeconds === "number") out.sessionEndTimeoutSeconds = raw.sessionEndTimeoutSeconds;
	if (typeof raw.shell === "string") out.shell = raw.shell;
	if (typeof raw.verbose === "boolean") out.verbose = raw.verbose;
	if (raw.startupSummary === "compact" || raw.startupSummary === "full" || raw.startupSummary === "off") {
		out.startupSummary = raw.startupSummary;
	}
	return out;
}

export function loadClaudeHooks(paths: LoadPaths, options: ClaudeHooksOptions): LoadResult {
	const home = paths.home ?? homedir();
	const files: string[] = [];
	if (options.loadUserSettings) files.push(join(home, ".claude", "settings.json"));
	if (paths.includeProject) {
		const claudeDir = join(paths.projectDir, ".claude");
		for (const name of SETTINGS_FILES) files.push(join(claudeDir, name));
		for (const name of listExtraFiles(claudeDir, options.extraFiles)) files.push(join(claudeDir, name));
	}

	const result: LoadResult = { hooks: [], sources: [], warnings: [] };
	if (process.env.CLAUDE_CONFIG_DIR) result.warnings.push("CLAUDE_CONFIG_DIR is not supported; using the standard Claude settings locations");
	const standardFiles = files.slice(0, options.loadUserSettings ? 3 : 2);
	let disableAllHooks: boolean | undefined;
	for (const file of standardFiles) {
		if (!existsSync(file)) continue;
		const parsed = readJson(file);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>).disableAllHooks === "boolean") {
			disableAllHooks = (parsed as Record<string, unknown>).disableAllHooks as boolean;
		}
	}
	result.disabled = disableAllHooks === true;
	const warnedTypes = new Set<string>();
	const warnedMatchers = new Set<string>();
	for (const file of files) {
		if (!existsSync(file)) continue;
		const parsed = readJson(file);
		if (parsed === undefined) {
			result.warnings.push(`Could not parse ${file}, skipping`);
			continue;
		}
		warnUnsupported(parsed, file, result.warnings);
		if (result.disabled && !standardFiles.includes(file)) continue;
		const hooksSection = extractHooksSection(parsed);
		if (!hooksSection) continue;
		result.sources.push(file);
		for (const [event, groups] of Object.entries(hooksSection)) {
			if (!Array.isArray(groups)) continue;
			for (const group of groups as RawHookGroup[]) {
				if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) continue;
				const matcher = typeof group.matcher === "string" ? group.matcher : undefined;
				for (const def of group.hooks as RawHookDefinition[]) {
					if (!def || typeof def !== "object") continue;
					const type = def.type ?? "command";
					if (type !== "command") {
						if (!warnedTypes.has(type)) {
							warnedTypes.add(type);
							result.warnings.push(`Hook type "${type}" is not supported, only "command" hooks run (first seen in ${file})`);
						}
						continue;
					}
					if (typeof def.command !== "string" || def.command.trim() === "") continue;
					const invalid = invalidMatcher(matcher);
					if (invalid && !warnedMatchers.has(invalid)) {
						warnedMatchers.add(invalid);
						result.warnings.push(`Invalid hook matcher regex "${invalid}"; it matches no tools (first seen in ${file})`);
					}
					const timeoutSeconds = typeof def.timeout === "number" && def.timeout > 0 ? def.timeout : undefined;
					result.hooks.push({
						event,
						matcher,
						command: def.command,
						timeoutMs: (timeoutSeconds ?? defaultTimeoutFor(event, options)) * 1000,
						source: file,
					});
				}
			}
		}
	}
	if (result.disabled) result.hooks = [];
	return result;
}

function warnUnsupported(parsed: unknown, file: string, warnings: string[]): void {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
	const obj = parsed as Record<string, unknown>;
	const unsupported: Array<[string, string]> = [
		["managed", "managed settings"],
		["managedSettings", "managed settings"],
		["allowManagedHooksOnly", "managed settings"],
		["cliSettings", "CLI settings"],
		["plugins", "plugins"],
		["skills", "skills"],
	];
	for (const [key, label] of unsupported) {
		if (key in obj) warnings.push(`${label} in ${file} are not supported by pi-claude-hooks`);
	}
}

function defaultTimeoutFor(event: string, options: ClaudeHooksOptions): number {
	if (event === "SessionEnd") return options.sessionEndTimeoutSeconds;
	if (event === "UserPromptSubmit") return Math.min(30, options.defaultTimeoutSeconds);
	return options.defaultTimeoutSeconds;
}

export function extractHooksSection(parsed: unknown): Record<string, unknown> | undefined {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	const obj = parsed as Record<string, unknown>;
	if (obj.hooks && typeof obj.hooks === "object" && !Array.isArray(obj.hooks)) {
		return obj.hooks as Record<string, unknown>;
	}
	const eventKeys = Object.keys(obj).filter((k) => KNOWN_EVENT_NAMES.has(k) && Array.isArray(obj[k]));
	if (eventKeys.length === 0) return undefined;
	const section: Record<string, unknown> = {};
	for (const k of eventKeys) section[k] = obj[k];
	return section;
}

export function listExtraFiles(claudeDir: string, patterns: string[]): string[] {
	if (patterns.length === 0) return [];
	let entries: string[];
	try {
		entries = readdirSync(claudeDir);
	} catch {
		return [];
	}
	const regexes = patterns.map(globToRegex);
	return entries
		.filter((name) => !SETTINGS_FILES.includes(name))
		.filter((name) => regexes.some((re) => re.test(name)))
		.filter((name) => {
			try {
				return statSync(join(claudeDir, name)).isFile();
			} catch {
				return false;
			}
		})
		.sort();
}

export function globToRegex(pattern: string): RegExp {
	let out = "^";
	for (const ch of pattern) {
		if (ch === "*") out += "[^/]*";
		else if (ch === "?") out += "[^/]";
		else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`${out}$`);
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}
