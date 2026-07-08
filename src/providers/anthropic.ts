import { streamSSELines, STREAM_TIMEOUT_MS } from '../core/utils';
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../canonical/types';
import type { Provider, ProviderContext } from './base';

const ANTHROPIC_VERSION = '2023-06-01';

const STOP_REASON_MAP: Record<string, string> = {
	end_turn: 'stop',
	max_tokens: 'length',
	content_filter: 'content_filter',
	stop_sequence: 'stop',
};

export class AnthropicProvider implements Provider {
	readonly type = 'anthropic';
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
	}

	parseResponse(data: any, req: CanonicalRequest): CanonicalResponse {
		let textContent: string | null = null;
		let reasoningContent: string | undefined;
		const toolCalls: any[] = [];

		for (const block of data.content ?? []) {
			if (block.type === 'text') textContent = (textContent ?? '') + block.text;
			if (block.type === 'thinking') reasoningContent = (reasoningContent ?? '') + block.thinking;
			if (block.type === 'tool_use') {
				toolCalls.push({
					id: block.id,
					type: 'function',
					function: {
						name: block.name,
						arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
					},
				});
			}
		}

		const message: any = {
			role: 'assistant',
			content: textContent,
			...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
		};
		if (toolCalls.length > 0) {
			message.tool_calls = toolCalls;
		}

		return {
			id: data.id ?? '',
			model: data.model ?? req.model,
			choices: [{
				index: 0,
				message,
				finish_reason: STOP_REASON_MAP[data.stop_reason] ?? data.stop_reason ?? 'stop',
			}],
			usage: data.usage,
		};
	}

	parseStream(response: Response, req: CanonicalRequest): AsyncIterable<CanonicalStreamEvent> {
		return anthropicStreamToCanonical(response);
	}

	async invoke(req: CanonicalRequest, ctx: ProviderContext): Promise<{ response: Response }> {
		let system: string | undefined;
		const messages: any[] = [];

		for (const msg of req.messages ?? []) {
			if (msg.role === 'system') {
				system = typeof msg.content === 'string' ? msg.content : undefined;
				continue;
			}

			if (msg.role === 'tool' && msg.tool_call_id) {
				const resultContent = typeof msg.content === 'string' ? msg.content : '';
				messages.push({
					role: 'user',
					content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: resultContent }],
				});
				continue;
			}

			let content: any;

			if (typeof msg.content === 'string') {
				content = msg.content;
			} else if (Array.isArray(msg.content)) {
				content = msg.content.map(block => {
					if (block.type === 'text') return { type: 'text', text: block.text };
					if (block.type === 'image_url') {
						const url = block.image_url?.url ?? '';
						if (url.startsWith('data:')) {
							const match = url.match(/^data:([^;]+);base64,(.+)$/);
							if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
						}
						return { type: 'image', source: { type: 'url', url } };
					}
					if (block.type === 'input_json') {
						const json = block.json;
						if (json.id && json.name) {
							return { type: 'tool_use', id: json.id, name: json.name, input: json.arguments ?? {} };
						}
						if (json.tool_call_id) {
							return { type: 'tool_result', tool_use_id: json.tool_call_id, content: json.result };
						}
					}
					return block;
				});
			} else {
				content = '';
			}

			if (msg.role === 'assistant' && msg.tool_calls?.length) {
				const toolUseBlocks = msg.tool_calls.map((tc: any) => {
					let input: unknown = tc.function.arguments ?? {};
					if (typeof input === 'string') { try { input = JSON.parse(input); } catch {} }
					return {
						type: 'tool_use',
						id: tc.id,
						name: tc.function.name,
						input,
					};
				});
				// Merge tool use blocks with existing content instead of overwriting
				const textContent = Array.isArray(content) ? content : (typeof content === 'string' && content ? [{ type: 'text', text: content }] : []);
				content = [...textContent, ...toolUseBlocks];
			}

			messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content });
		}

		// Start with all original params from client, then override with IR values
		const meta = req.metadata as any;
		const body: any = { ...(meta || {}) };
		delete body.extra_body;
		if (meta?.extra_body && typeof meta.extra_body === 'object') {
			Object.assign(body, meta.extra_body);
		}
		body.model = req.model;
		body.max_tokens = req.max_tokens ?? 4096;
		body.messages = messages;
		if (system) body.system = system;
		if (req.stream) body.stream = true;
		if (req.temperature != null) body.temperature = req.temperature;
		if (req.top_p != null) body.top_p = req.top_p;
		if (req.tools?.length) {
			body.tools = req.tools.map(t => ({
				name: t.function.name,
				description: t.function.description,
				input_schema: t.function.parameters ?? { type: 'object', properties: {} },
			}));
		}
		if (req.tool_choice) {
			if (req.tool_choice === 'auto') body.tool_choice = { type: 'auto' };
			else if (req.tool_choice === 'none') body.tool_choice = { type: 'none' };
			else if (typeof req.tool_choice === 'object') body.tool_choice = { type: 'tool', name: req.tool_choice.name };
		}
		// If output_config isn't already set natively (via metadata spread),
		// convert reasoning_effort from metadata as fallback
		if (!body.output_config && meta?.reasoning_effort) {
			body.output_config = { effort: meta.reasoning_effort as string };
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'x-api-key': ctx.apiKey,
			'anthropic-version': ANTHROPIC_VERSION,
		};
		if (ctx.requestHeaders) {
			for (const [key, value] of ctx.requestHeaders.entries()) {
				const lower = key.toLowerCase();
				if (lower === 'content-type' || lower === 'x-api-key') continue;
				headers[key] = value;
			}
		}

		let url = `${this.baseUrl}/v1/messages`;
		if (ctx.queryParams?.size) {
			url += '?' + ctx.queryParams.toString();
		}

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(120_000),
		});
		return { response };
	}
}

function parseSseEvents(parsed: any): { events: CanonicalStreamEvent[]; stopReason?: string; usage?: { input_tokens?: number; output_tokens?: number }; isError?: boolean } {
	const events: CanonicalStreamEvent[] = [];
	let stopReason: string | undefined;
	let usage: { input_tokens?: number; output_tokens?: number } | undefined;
	let isError = false;

	if (parsed.type === 'content_block_start') {
		if (parsed.content_block?.type === 'tool_use') {
			events.push({ type: 'tool_call_delta', id: parsed.content_block.id, index: parsed.index, name: parsed.content_block.name });
		}
	} else if (parsed.type === 'content_block_delta') {
		if (parsed.delta?.type === 'text_delta') events.push({ type: 'text_delta', text: parsed.delta.text });
		else if (parsed.delta?.type === 'thinking_delta') events.push({ type: 'reasoning_delta', text: parsed.delta.thinking });
		else if (parsed.delta?.type === 'input_json_delta') events.push({ type: 'tool_call_delta', id: '', index: parsed.index, argumentsDelta: parsed.delta.partial_json });
	} else if (parsed.type === 'message_delta') {
		if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
		if (parsed.usage) usage = parsed.usage;
	} else if (parsed.type === 'message_start') {
		if (parsed.message?.usage) usage = parsed.message.usage;
	} else if (parsed.type === 'error') {
		events.push({ type: 'error', code: parsed.error?.type ?? 'api_error', message: parsed.error?.message ?? 'Unknown error' });
		isError = true;
	}

	return { events, stopReason, usage, isError };
}

async function* anthropicStreamToCanonical(response: Response): AsyncIterable<CanonicalStreamEvent> {
	let stopReason: string | undefined;
	let usage: { input_tokens?: number; output_tokens?: number } | undefined;

	for await (const json of streamSSELines(response, { timeoutMs: STREAM_TIMEOUT_MS })) {
		try {
			const result = parseSseEvents(JSON.parse(json));
			if (result.stopReason) stopReason = result.stopReason;
			if (result.usage) usage = { ...usage, ...result.usage };
			yield* result.events;
			if (result.isError) return;
		} catch { console.warn('[stream] Invalid JSON chunk:', json); }
	}
	yield { type: 'done', finishReason: stopReason, usage };
}
