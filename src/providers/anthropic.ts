import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../core/types';
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
			if (block.type === 'text') textContent = block.text;
			if (block.type === 'thinking') reasoningContent = block.thinking;
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

			const role = msg.role === 'assistant' ? 'assistant' : 'user';
			let content: any;

			if (typeof msg.content === 'string') {
				content = msg.content;
			} else if (Array.isArray(msg.content)) {
				content = msg.content.map(block => {
					if (block.type === 'text') return { type: 'text', text: (block as any).text };
					if (block.type === 'image_url') {
						const url = (block as any).url ?? '';
						if (url.startsWith('data:')) {
							const match = url.match(/^data:([^;]+);base64,(.+)$/);
							if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
						}
						return { type: 'image', source: { type: 'url', url } };
					}
					if (block.type === 'input_json') {
						const json = (block as any).json;
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

			messages.push({ role, content });
		}

		const body: any = { model: req.model, max_tokens: req.max_tokens ?? 4096, messages };
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

		const response = await fetch(`${this.baseUrl}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': ctx.apiKey,
				'anthropic-version': ANTHROPIC_VERSION,
			},
			body: JSON.stringify(body),
		});
		return { response };
	}
}

const STREAM_TIMEOUT_MS = 300_000; // 5 min

async function* anthropicStreamToCanonical(response: Response): AsyncIterable<CanonicalStreamEvent> {
	console.log('[anthropic-stream] upstream status:', response.status);
	const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	let chunkCount = 0;
	let stopReason: string | undefined;

	while (true) {
		const result = await Promise.race([
			reader.read(),
			new Promise<{ done: true; value: undefined }>(r => setTimeout(() => r({ done: true, value: undefined }), STREAM_TIMEOUT_MS)),
		]);
		const { done, value } = result;
		if (done) { console.log('[anthropic-stream] upstream closed after', chunkCount, 'chunks, buffer:', buffer.length, 'bytes'); break; }
		chunkCount++;
		buffer += value;
		const lines = buffer.split('\n');
		buffer = lines.pop()!;

		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.substring(6).trim();
			if (!data.startsWith('{')) continue;

			let parsed: any;
			try { parsed = JSON.parse(data); } catch { continue; }

			if (parsed.type === 'content_block_start') {
				if (parsed.content_block?.type === 'tool_use') {
					yield { type: 'tool_call_delta', id: parsed.content_block.id, index: parsed.index, name: parsed.content_block.name };
				}
			} else if (parsed.type === 'content_block_delta') {
				if (parsed.delta?.type === 'text_delta') {
					yield { type: 'text_delta', text: parsed.delta.text };
				} else if (parsed.delta?.type === 'thinking_delta') {
					yield { type: 'reasoning_delta', text: parsed.delta.thinking };
				} else if (parsed.delta?.type === 'input_json_delta') {
					yield { type: 'tool_call_delta', id: '', index: parsed.index, argumentsDelta: parsed.delta.partial_json };
				}
			} else if (parsed.type === 'message_delta') {
				if (parsed.delta?.stop_reason) {
					stopReason = parsed.delta.stop_reason;
					console.log('[anthropic-stream] stop_reason:', stopReason);
				}
			} else if (parsed.type === 'message_stop') {
				console.log('[anthropic-stream] got message_stop');
			} else if (parsed.type === 'error') {
				console.log('[anthropic-stream] upstream error:', parsed.error);
				yield { type: 'error', code: parsed.error?.type ?? 'api_error', message: parsed.error?.message ?? 'Unknown error' };
				return;
			}
		}
	}

	// Process remaining buffer after upstream closed
	if (buffer) {
		const lines = (buffer + '\n').split('\n');
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.substring(6).trim();
			if (!data.startsWith('{')) continue;
			try {
				const parsed = JSON.parse(data);
				if (parsed.type === 'content_block_start') {
					if (parsed.content_block?.type === 'tool_use') {
						yield { type: 'tool_call_delta', id: parsed.content_block.id, index: parsed.index, name: parsed.content_block.name };
					}
				} else if (parsed.type === 'content_block_delta') {
					if (parsed.delta?.type === 'text_delta') yield { type: 'text_delta', text: parsed.delta.text };
					else if (parsed.delta?.type === 'thinking_delta') yield { type: 'reasoning_delta', text: parsed.delta.thinking };
					else if (parsed.delta?.type === 'input_json_delta') yield { type: 'tool_call_delta', id: '', index: parsed.index, argumentsDelta: parsed.delta.partial_json };
				} else if (parsed.type === 'message_delta') {
					if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
				} else if (parsed.type === 'message_stop') {
					// terminal — handled by done yield below
				}
			} catch {}
		}
	}
	yield { type: 'done', finishReason: stopReason };
}
