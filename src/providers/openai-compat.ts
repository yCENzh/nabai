import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../core/types';
import type { Provider, ProviderContext } from './base';

/**
 * Generic OpenAI-compatible provider.
 * Works with OpenAI, DeepSeek, Gemini (via OpenAI-compat endpoint), and any custom endpoint.
 */
export class OpenAICompatProvider implements Provider {
	readonly type = 'openai_compat';
	private baseUrl: string;

	constructor(baseUrl: string = 'https://api.openai.com/v1') {
		this.baseUrl = baseUrl;
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
				// Extract tool_use blocks → OpenAI tool_calls format
				const toolCalls: any[] = [];
				const textParts: string[] = [];
				for (const block of m.content) {
					if (block.type === 'input_json' && (block as any).json?.id && (block as any).json?.name) {
						const j = (block as any).json;
						toolCalls.push({ id: j.id, type: 'function', function: { name: j.name, arguments: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments ?? {}) } });
					} else if (block.type === 'text') {
						textParts.push((block as any).text);
					}
				}
				if (toolCalls.length > 0) {
					messages.push({ role: 'assistant', content: textParts.join('') || null, tool_calls: toolCalls });
				} else {
					messages.push({ role: 'assistant', content: m.content });
				}
			} else if (m.role === 'user' && Array.isArray(m.content)) {
				// Extract tool_result blocks → separate role:"tool" messages
				const toolResults: any[] = [];
				const otherBlocks: any[] = [];
				for (const block of m.content) {
					if (block.type === 'input_json' && (block as any).json?.tool_call_id) {
						const j = (block as any).json;
						toolResults.push({ role: 'tool', tool_call_id: j.tool_call_id, content: typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? '') });
					} else {
						otherBlocks.push(block);
					}
				}
				if (otherBlocks.length > 0) messages.push({ role: 'user', content: otherBlocks.length === 1 && otherBlocks[0].type === 'text' ? otherBlocks[0].text : otherBlocks });
				messages.push(...toolResults);
			} else {
				// For assistant messages with only text blocks, join into a string for OpenAI
				let content = m.content;
				if (m.role === 'assistant' && Array.isArray(m.content)) {
					const texts = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text);
					if (texts.length > 0) content = texts.join('');
				}
				messages.push({ role: m.role, content, ...(m.name ? { name: m.name } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) });
			}
		}

		const body: any = {
			model: req.model,
			messages,
			stream: req.stream ?? false,
		};
		if (req.tools?.length) body.tools = req.tools;
		if (req.tool_choice) body.tool_choice = req.tool_choice;
		if (req.temperature != null) body.temperature = req.temperature;
		if (req.top_p != null) body.top_p = req.top_p;
		if (req.max_tokens != null) body.max_tokens = req.max_tokens;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ctx.apiKey}` },
			body: JSON.stringify(body),
		});
		return { response };
	}
}

async function* openaiStreamToCanonical(response: Response): AsyncIterable<CanonicalStreamEvent> {
	console.log('[stream] upstream status:', response.status, 'headers:', JSON.stringify(Object.fromEntries(response.headers)));
	const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	let chunkCount = 0;
	let finishReason: string | undefined;

	while (true) {
		const { done, value } = await reader.read();
		if (done) { console.log('[stream] upstream closed after', chunkCount, 'chunks, buffer:', buffer.length, 'bytes'); break; }
		chunkCount++;
		buffer += value;
		const lines = buffer.split('\n');
		buffer = lines.pop()!;

		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.substring(6).trim();
			if (data === '[DONE]') {
				console.log('[stream] got [DONE]');
				continue;
			}
			if (!data.startsWith('{')) continue;
			try {
				const parsed = JSON.parse(data);
				const choice = parsed.choices?.[0];
				if (!choice) continue;
				if (choice.delta?.content) yield { type: 'text_delta', text: choice.delta.content };
				if (choice.delta?.reasoning_content) yield { type: 'reasoning_delta', text: choice.delta.reasoning_content };
				if (choice.delta?.tool_calls) {
					for (const tc of choice.delta.tool_calls) {
						yield {
							type: 'tool_call_delta',
							id: tc.id ?? '',
							index: tc.index,
							name: tc.function?.name,
							argumentsDelta: tc.function?.arguments,
						};
					}
				}
				if (choice.finish_reason) { console.log('[stream] finish_reason:', choice.finish_reason); finishReason = choice.finish_reason; }
			} catch {}
		}
	}

	// Process remaining buffer after upstream closed
	if (buffer) {
		const lines = (buffer + '\n').split('\n');
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.substring(6).trim();
			if (data === '[DONE]') continue;
			if (!data.startsWith('{')) continue;
			try {
				const parsed = JSON.parse(data);
				const choice = parsed.choices?.[0];
				if (choice) {
					if (choice.delta?.content) yield { type: 'text_delta', text: choice.delta.content };
					if (choice.delta?.reasoning_content) yield { type: 'reasoning_delta', text: choice.delta.reasoning_content };
					if (choice.delta?.tool_calls) {
						for (const tc of choice.delta.tool_calls) {
							yield { type: 'tool_call_delta', id: tc.id ?? '', index: tc.index, name: tc.function?.name, argumentsDelta: tc.function?.arguments };
						}
					}
					if (choice.finish_reason) finishReason = choice.finish_reason;
				}
			} catch {}
		}
	}
	yield { type: 'done', finishReason: finishReason ?? 'stop' };
}
