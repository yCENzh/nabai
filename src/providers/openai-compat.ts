import { streamSSELines, STREAM_TIMEOUT_MS } from '../core/utils';
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent, ContentBlock } from '../core/types';
import type { Provider, ProviderContext } from './base';

/**
 * Generic OpenAI-compatible provider.
 * Works with OpenAI, DeepSeek, Gemini (via OpenAI-compat endpoint), and any custom endpoint.
 */
export class OpenAICompatProvider implements Provider {
	readonly type = 'openai_compat';
	private baseUrl: string;

	constructor(baseUrl: string = 'https://api.openai.com/v1') {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
	}

	parseResponse(data: any, req: CanonicalRequest): CanonicalResponse {
		return {
			id: data.id ?? '',
			model: data.model ?? req.model,
			choices: (data.choices ?? []).map((c: any) => ({
				index: c.index ?? 0,
				message: {
					role: 'assistant',
					content: c.message?.content ?? null,
					...(c.message?.reasoning_content ? { reasoning_content: c.message.reasoning_content } : {}),
					...(c.message?.tool_calls?.length ? { tool_calls: c.message.tool_calls } : {}),
				},
				finish_reason: c.finish_reason ?? 'stop',
			})),
		};
	}

	parseStream(response: Response, req: CanonicalRequest): AsyncIterable<CanonicalStreamEvent> {
		return openaiStreamToCanonical(response);
	}

	async invoke(req: CanonicalRequest, ctx: ProviderContext): Promise<{ response: Response }> {
		const url = `${this.baseUrl}/chat/completions`;
		const messages: any[] = [];

		for (const m of req.messages ?? []) {
			if (m.role === 'assistant' && Array.isArray(m.content)) {
				const toolCalls: any[] = [];
				const textParts: string[] = [];
				for (const block of m.content) {
					if (block.type === 'input_json' && block.json?.id && block.json?.name) {
						const j = block.json;
						toolCalls.push({ id: j.id, type: 'function', function: { name: j.name, arguments: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments ?? {}) } });
					} else if (block.type === 'text') {
						textParts.push(block.text);
					}
				}
				if (toolCalls.length > 0) {
					messages.push({ role: 'assistant', content: textParts.join('') || null, tool_calls: toolCalls });
				} else {
					messages.push({ role: 'assistant', content: m.content });
				}
			} else if (m.role === 'user' && Array.isArray(m.content)) {
				const toolResults: any[] = [];
				const otherBlocks: ContentBlock[] = [];
				for (const block of m.content) {
					if (block.type === 'input_json' && block.json?.tool_call_id) {
						const j = block.json;
						toolResults.push({ role: 'tool', tool_call_id: j.tool_call_id, content: typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? '') });
					} else {
						otherBlocks.push(block);
					}
				}
				if (otherBlocks.length > 0) messages.push({ role: 'user', content: otherBlocks.length === 1 && otherBlocks[0].type === 'text' ? otherBlocks[0].text : otherBlocks });
				messages.push(...toolResults);
			} else {
				messages.push({ role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) });
			}
		}

		const meta = req.metadata as any;
		// Start with all original params from client, then override with IR values
		const body: any = { ...(meta || {}) };
		delete body.extra_body;
		if (meta?.extra_body && typeof meta.extra_body === 'object') {
			Object.assign(body, meta.extra_body);
		}
		body.model = req.model;
		body.messages = messages;
		body.stream = req.stream ?? false;
		if (req.tools?.length) body.tools = req.tools;
		if (req.tool_choice) {
			// Convert canonical { type: 'function', name } back to OpenAI format
			if (typeof req.tool_choice === 'object' && 'name' in req.tool_choice) {
				body.tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
			} else {
				body.tool_choice = req.tool_choice;
			}
		}
		if (req.temperature != null) body.temperature = req.temperature;
		if (req.top_p != null) body.top_p = req.top_p;
		if (req.max_tokens != null) body.max_tokens = req.max_tokens;
		if (body.stream && !body.stream_options) {
			body.stream_options = { include_usage: true };
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${ctx.apiKey}`,
		};
		if (ctx.requestHeaders) {
			for (const [key, value] of ctx.requestHeaders.entries()) {
				const lower = key.toLowerCase();
				if (lower === 'content-type' || lower === 'authorization') continue;
				headers[key] = value;
			}
		}

		let upstreamUrl = url;
		if (ctx.queryParams?.size) {
			upstreamUrl += (url.includes('?') ? '&' : '?') + ctx.queryParams.toString();
		}

		const response = await fetch(upstreamUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(120_000),
		});
		return { response };
	}
}

function parseOpenAiChunk(parsed: any): { events: CanonicalStreamEvent[]; finishReason?: string; usage?: { input_tokens?: number; output_tokens?: number } } {
	const events: CanonicalStreamEvent[] = [];
	let finishReason: string | undefined;
	let usage: { input_tokens?: number; output_tokens?: number } | undefined;

	if (parsed.usage) {
		usage = { input_tokens: parsed.usage.prompt_tokens, output_tokens: parsed.usage.completion_tokens };
	}

	const choice = parsed.choices?.[0];
	if (!choice) return { events, finishReason, usage };
	if (choice.delta?.content) events.push({ type: 'text_delta', text: choice.delta.content });
	if (choice.delta?.reasoning_content) events.push({ type: 'reasoning_delta', text: choice.delta.reasoning_content });
	if (choice.delta?.tool_calls) {
		for (const tc of choice.delta.tool_calls) {
			events.push({ type: 'tool_call_delta', id: tc.id ?? '', index: tc.index, name: tc.function?.name, argumentsDelta: tc.function?.arguments });
		}
	}
	if (choice.finish_reason) finishReason = choice.finish_reason;
	return { events, finishReason, usage };
}

async function* openaiStreamToCanonical(response: Response): AsyncIterable<CanonicalStreamEvent> {
	let finishReason: string | undefined;
	let usage: { input_tokens?: number; output_tokens?: number } | undefined;

	for await (const json of streamSSELines(response, { timeoutMs: STREAM_TIMEOUT_MS })) {
		try {
			const { events, finishReason: fr, usage: u } = parseOpenAiChunk(JSON.parse(json));
			if (fr) finishReason = fr;
			if (u) usage = u;
			yield* events;
		} catch { console.warn('[stream] Invalid JSON chunk:', json); }
	}
	yield { type: 'done', finishReason: finishReason ?? 'stop', usage };
}
