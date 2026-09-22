export const SUPPORTED_EVENTS = [
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"UserPromptSubmit",
	"SessionStart",
	"SessionEnd",
	"Stop",
	"PreCompact",
	"PostCompact",
] as const;

export type ClaudeHookEvent = (typeof SUPPORTED_EVENTS)[number];

export const KNOWN_EVENT_NAMES = new Set<string>([
	...SUPPORTED_EVENTS,
	"SubagentStart",
	"SubagentStop",
	"Notification",
	"PermissionRequest",
	"PermissionDenied",
	"PostToolBatch",
	"Setup",
	"UserPromptExpansion",
	"StopFailure",
	"TeammateIdle",
	"InstructionsLoaded",
	"ConfigChange",
	"CwdChanged",
	"DirectoryAdded",
	"FileChanged",
	"WorktreeCreate",
	"WorktreeRemove",
	"PreModelSwitch",
	"PostModelSwitch",
	"Elicitation",
	"ElicitationResult",
	"MessageDisplay",
	"TaskCreated",
	"TaskCompleted",
]);

export interface RawHookDefinition {
	type?: string;
	command?: string;
	timeout?: number;
	[key: string]: unknown;
}

export interface RawHookGroup {
	matcher?: string;
	hooks?: RawHookDefinition[];
	[key: string]: unknown;
}

export interface LoadedHook {
	event: string;
	matcher: string | undefined;
	command: string;
	timeoutMs: number;
	source: string;
}

export interface HookSpecificOutput {
	hookEventName?: string;
	permissionDecision?: "allow" | "deny" | "ask" | "defer";
	permissionDecisionReason?: string;
	updatedInput?: Record<string, unknown>;
	additionalContext?: string;
}

export interface HookJsonOutput {
	continue?: boolean;
	stopReason?: string;
	suppressOutput?: boolean;
	systemMessage?: string;
	decision?: "approve" | "block" | "allow" | "deny";
	reason?: string;
	hookSpecificOutput?: HookSpecificOutput;
}

export interface HookRunResult {
	hook: LoadedHook;
	code: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	json: HookJsonOutput | undefined;
}

export interface ClaudeHooksOptions {
	enabled: boolean;
	loadUserSettings: boolean;
	extraFiles: string[];
	defaultTimeoutSeconds: number;
	sessionEndTimeoutSeconds: number;
	shell: string | undefined;
	verbose: boolean;
	startupSummary: StartupSummaryMode;
}

export type StartupSummaryMode = "compact" | "full" | "off";

export interface LoadResult {
	hooks: LoadedHook[];
	sources: string[];
	warnings: string[];
}
