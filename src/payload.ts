import { claudeToolName, toClaudeToolInput } from "./tools.ts";

type JsonRecord = Record<string, unknown>;

/** Render Pi's result blocks while retaining the original blocks separately. */
export function renderPiContent(content: readonly unknown[]): string {
	return content
		.map((block) => {
			if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
				const text = (block as { text?: unknown }).text;
				return typeof text === "string" ? text : "";
			}
			return "[image]";
		})
		.join("\n");
}

export function buildToolCallPayload(
	base: JsonRecord,
	piToolName: string,
	input: JsonRecord,
	toolUseId: string,
): JsonRecord {
	return {
		...base,
		tool_name: claudeToolName(piToolName),
		pi_tool_name: piToolName,
		tool_input: toClaudeToolInput(piToolName, input),
		tool_use_id: toolUseId,
	};
}

export function buildToolResultPayload(
	base: JsonRecord,
	piToolName: string,
	input: JsonRecord,
	toolUseId: string,
	content: readonly unknown[],
	details: unknown,
	isError: boolean,
	aborted: boolean,
): JsonRecord {
	const rendered = renderPiContent(content);
	const common = buildToolCallPayload(base, piToolName, input, toolUseId);
	if (isError) {
		return {
			...common,
			error: rendered,
			is_interrupt: aborted || isKnownAbortText(rendered),
		};
	}
	return {
		...common,
		tool_response: {
			output: rendered,
			content,
			details,
			is_error: false,
		},
	};
}

export function isKnownAbortText(text: string): boolean {
	return /\b(?:command|request|operation)\s+aborted\b|\baborted\s+by\s+(?:user|signal)\b/i.test(text);
}
