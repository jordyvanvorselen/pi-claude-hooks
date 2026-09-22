const EXACT_LIST_CHARS = /^[A-Za-z0-9_\- ,|]*$/;

export function matcherMatches(matcher: string | undefined, candidates: string[]): boolean {
	if (matcher === undefined) return true;
	const trimmed = matcher.trim();
	if (trimmed === "" || trimmed === "*") return true;
	const lowered = candidates.map((c) => c.toLowerCase());
	if (EXACT_LIST_CHARS.test(trimmed)) {
		const parts = trimmed
			.split(/[,|]/)
			.map((p) => p.trim().toLowerCase())
			.filter(Boolean);
		return parts.some((p) => lowered.includes(p));
	}
	try {
		const re = new RegExp(trimmed, "i");
		return candidates.some((c) => re.test(c));
	} catch {
		return lowered.includes(trimmed.toLowerCase());
	}
}
