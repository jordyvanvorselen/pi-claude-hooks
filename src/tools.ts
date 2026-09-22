const PI_TO_CLAUDE: Record<string, string> = {
	bash: "Bash",
	powershell: "Bash",
	read: "Read",
	write: "Write",
	edit: "Edit",
	grep: "Grep",
	find: "Glob",
	ls: "LS",
};

const PATH_TOOLS = new Set(["read", "write", "edit"]);

type Input = Record<string, unknown>;

interface EditEntry {
	oldText?: unknown;
	newText?: unknown;
}

export function claudeToolName(piToolName: string): string {
	return PI_TO_CLAUDE[piToolName] ?? piToolName;
}

export function toolNameCandidates(piToolName: string): string[] {
	const claude = claudeToolName(piToolName);
	return claude === piToolName ? [piToolName] : [piToolName, claude];
}

export function toClaudeToolInput(piToolName: string, input: Input | undefined): Input {
	const out: Input = { ...(input ?? {}) };
	if (PATH_TOOLS.has(piToolName) && typeof out.path === "string") {
		out.file_path = out.path;
	}
	if (piToolName === "edit" && Array.isArray(out.edits)) {
		const edits = out.edits as EditEntry[];
		out.old_string = edits.map((e) => stringOrEmpty(e?.oldText)).join("\n");
		out.new_string = edits.map((e) => stringOrEmpty(e?.newText)).join("\n");
	}
	if (piToolName === "grep" && typeof out.ignoreCase === "boolean") {
		out["-i"] = out.ignoreCase;
	}
	return out;
}

export interface UpdatedInputResult {
	input: Input;
	warnings: string[];
}

export function fromClaudeToolInput(piToolName: string, original: Input, updated: Input): UpdatedInputResult {
	const warnings: string[] = [];
	const out: Input = { ...updated };

	if (PATH_TOOLS.has(piToolName)) {
		const originalPath = original.path;
		if (typeof out.file_path === "string" && out.file_path !== originalPath) {
			out.path = out.file_path;
		} else if (out.path === undefined && typeof out.file_path === "string") {
			out.path = out.file_path;
		}
		delete out.file_path;
	}

	if (piToolName === "edit") {
		const originalEdits = Array.isArray(original.edits) ? (original.edits as EditEntry[]) : [];
		const edits = Array.isArray(out.edits) ? (out.edits as EditEntry[]).map((e) => ({ ...e })) : originalEdits.map((e) => ({ ...e }));
		const oldJoined = originalEdits.map((e) => stringOrEmpty(e?.oldText)).join("\n");
		const newJoined = originalEdits.map((e) => stringOrEmpty(e?.newText)).join("\n");
		const oldChanged = typeof out.old_string === "string" && out.old_string !== oldJoined;
		const newChanged = typeof out.new_string === "string" && out.new_string !== newJoined;
		if (oldChanged || newChanged) {
			if (edits.length === 1) {
				if (oldChanged) edits[0].oldText = out.old_string;
				if (newChanged) edits[0].newText = out.new_string;
			} else {
				warnings.push(
					"updatedInput changed old_string/new_string but the edit call has multiple edits, so that change was ignored",
				);
			}
		}
		out.edits = edits;
		delete out.old_string;
		delete out.new_string;
	}

	if (piToolName === "grep") {
		if (typeof out["-i"] === "boolean" && out["-i"] !== original.ignoreCase) out.ignoreCase = out["-i"];
		delete out["-i"];
	}

	return { input: out, warnings };
}

export function replaceInputInPlace(target: Input, next: Input): void {
	for (const key of Object.keys(target)) delete target[key];
	Object.assign(target, next);
}

function stringOrEmpty(value: unknown): string {
	return typeof value === "string" ? value : "";
}
