// Claude documents these as tool-name matchers rather than regular expressions.
const RESTRICTED_TOOL_NAMES = new Set([
	"Bash",
	"Read",
	"Write",
	"Edit",
	"Grep",
	"Glob",
	"LS",
	"NotebookEdit",
	"WebFetch",
	"WebSearch",
	"Task",
	"TodoWrite",
	"bash",
	"powershell",
	"read",
	"write",
	"edit",
	"grep",
	"find",
	"ls",
]);

export type MatcherWarning = (message: string) => void;

/** Match a Claude hook matcher against both its Claude and Pi tool names. */
export function matcherMatches(matcher: string | undefined, candidates: string[], warn?: MatcherWarning): boolean {
	if (matcher === undefined) return true;
	const trimmed = matcher.trim();
	if (trimmed === "" || trimmed === "*") return true;

	// Claude's documented list syntax is exact and case-sensitive. Do this
	// before regex handling so a pipe is never interpreted as regex alternation.
	if (trimmed.includes("|") || trimmed.includes(",")) {
		const parts = trimmed
			.split(/[|,]/)
			.map((part) => part.trim())
			.filter(Boolean);
		return parts.some((part) => candidates.includes(part));
	}
	if (RESTRICTED_TOOL_NAMES.has(trimmed)) return candidates.includes(trimmed);

	try {
		const regex = new RegExp(trimmed);
		return candidates.some((candidate) => regex.test(candidate));
	} catch {
		warn?.(`Invalid hook matcher regex "${trimmed}"; it matches no tools`);
		return false;
	}
}

export function invalidMatcher(matcher: string | undefined): string | undefined {
	if (matcher === undefined) return undefined;
	const trimmed = matcher.trim();
	if (!trimmed || trimmed === "*" || trimmed.includes("|") || trimmed.includes(",") || RESTRICTED_TOOL_NAMES.has(trimmed)) return undefined;
	try {
		new RegExp(trimmed);
		return undefined;
	} catch {
		return trimmed;
	}
}
