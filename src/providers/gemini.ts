import { HttpError, BASE_URL, API_VERSION, makeHeaders, streamSSELines, STREAM_TIMEOUT_MS } from '../core/utils';
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent, ContentBlock, CanonicalMessage } from '../canonical/types';
import type { Provider, ProviderContext } from './base';

const HARM_CATEGORIES = [
	'HARM_CATEGORY_HATE_SPEECH',
	'HARM_CATEGORY_SEXUALLY_EXPLICIT',
	'HARM_CATEGORY_DANGEROUS_CONTENT',
	'HARM_CATEGORY_HARASSMENT',
	'HARM_CATEGORY_CIVIC_INTEGRITY',
];

function transformConfig(req: any) {
	const fieldsMap: Record<string, string> = {
		frequency_penalty: 'frequencyPenalty',
		max_completion_tokens: 'maxOutputTokens',
		max_tokens: 'maxOutputTokens',
		n: 'candidateCount',
		presence_penalty: 'presencePenalty',
		seed: 'seed',
		stop: 'stopSequences',
		temperature: 'temperature',
		top_k: 'topK',
		top_p: 'topP',
	};

	const thinkingBudgetMap: Record<string, number> = {
		low: 1024,
		medium: 8192,
		high: 24576,
	};

	let cfg: any = {};
	for (let key in req) {
		const matchedKey = fieldsMap[key];
		if (matchedKey) {
			cfg[matchedKey] = req[key];
		}
	}

	if (req.response_format) {
		switch (req.response_format.type) {
			case 'json_schema':
				cfg.responseSchema = JSON.parse(JSON.stringify(req.response_format.json_schema?.schema ?? null));
				if (cfg.responseSchema) {
					delete cfg.responseSchema.strict;
					adjustProps(cfg.responseSchema);
				}
				if (cfg.responseSchema && 'enum' in cfg.responseSchema) {
					cfg.responseMimeType = 'text/x.enum';
					break;
				}
				// json_schema without enum → fall through to set application/json
			case 'json_object':
				cfg.responseMimeType = 'application/json';
				break;
			case 'text':
				cfg.responseMimeType = 'text/plain';
				break;
			default:
				throw new HttpError('Unsupported response_format.type', 400);
		}
	}
	if (req.reasoning_effort && req.reasoning_effort in thinkingBudgetMap) {
		cfg.thinkingConfig = { thinkingBudget: thinkingBudgetMap[req.reasoning_effort] };
	}

	return cfg;
}

async function transformMessages(messages: CanonicalMessage[]) {
	if (!messages) {
		return {};
	}

	const contents: any[] = [];
	let system_instruction;

	for (const item of messages) {
		const role = item.role === 'assistant' ? 'model' : item.role;
		if (role === 'system') {
			system_instruction = { parts: await transformMsg(item) };
			continue;
		}
		if (role !== 'model' && role !== 'user' && role !== 'tool') {
			throw new HttpError(`Unknown message role: "${item.role}"`, 400);
		}

		// Tool results (second round of tool calling)
		if (role === 'tool' || item.role === 'tool') {
			const parts: any[] = [];
			if (typeof item.content === 'string') {
				parts.push({
					functionResponse: {
						name: item.name ?? item.tool_call_id ?? '',
						response: { result: item.content },
					},
				});
			}
			contents.push({ role: 'user', parts });
			continue;
		}

		// Tool calls from assistant
		if (item.role === 'assistant' && item.tool_calls?.length) {
			let toolParts = (await transformMsg(item)) || [];
			for (const tc of item.tool_calls) {
				const args = typeof tc.function.arguments === 'string'
					? JSON.parse(tc.function.arguments)
					: tc.function.arguments ?? {};
				toolParts.push({ functionCall: { name: tc.function.name, args } });
			}
			contents.push({ role: 'model', parts: toolParts });
			continue;
		}

		if (system_instruction) {
			if (!contents[0]?.parts || (Array.isArray(contents[0]?.parts) && !contents[0]?.parts.some((part: any) => part.text))) {
				contents.unshift({ role: 'user', parts: [{ text: ' ' }] });
			}
		}

		contents.push({
			role,
			parts: await transformMsg(item),
		});
	}

	return { system_instruction, contents };
}

async function transformMsg({ content }: { content: string | ContentBlock[] }) {
	const parts = [];
	if (!Array.isArray(content)) {
		parts.push({ text: content });
		return parts;
	}

	for (const item of content) {
		switch (item.type) {
			case 'text':
				parts.push({ text: item.text });
				break;
			case 'image_url':
				parts.push(await parseImg(item.image_url.url));
				break;
			case 'input_audio':
				parts.push({
					inlineData: {
						mimeType: 'audio/' + item.input_audio.format,
						data: item.input_audio.data,
					},
				});
				break;
			case 'input_json':
				// Tool call or tool result in content blocks
				const j = item.json;
				if (j.id && j.name) {
					// Assistant tool call — emitted via msg.tool_calls already
					// but also handle inline input_json blocks
					parts.push({
						functionCall: {
							name: j.name,
							args: typeof j.arguments === 'string' ? JSON.parse(j.arguments) : j.arguments ?? {},
						},
					});
				} else if (j.tool_call_id) {
					// Tool result in content block
					parts.push({
						functionResponse: {
							name: j.tool_call_id,
							response: { result: j.result ?? '' },
						},
					});
				}
				break;
		}
	}

	if (content.every((item) => item.type === 'image_url')) {
		parts.push({ text: '' });
	}
	return parts;
}

async function parseImg(url: string) {
	let mimeType, data;
	if (url.startsWith('http://') || url.startsWith('https://')) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			if (!response.ok) {
				throw new Error(`${response.status} ${response.statusText} (${url})`);
			}
			mimeType = response.headers.get('content-type');
			const size = parseInt(response.headers.get('content-length') || '0', 10);
			if (size > 20_000_000) throw new Error('Image too large (>20MB)');
			const buf = new Uint8Array(await response.arrayBuffer());
			if (buf.length > 20_000_000) throw new Error('Image too large (>20MB)');
			data = btoa(new TextDecoder('latin1').decode(buf));
		} catch (err) {
			throw new Error('Error fetching image: ' + (err as Error).message);
		}
	} else {
		const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
		if (!match || !match.groups) {
			throw new HttpError('Invalid image data: ' + url, 400);
		}
		mimeType = match.groups.mimeType;
		data = match.groups.data;
	}
	return {
		inlineData: {
			mimeType,
			data,
		},
	};
}

function adjustSchema(schema: any) {
	const obj = schema[schema.type];
	delete obj.strict;
	return adjustProps(schema);
}

function adjustProps(schemaPart: any) {
	if (typeof schemaPart !== 'object' || schemaPart === null) {
		return;
	}
	if (Array.isArray(schemaPart)) {
		schemaPart.forEach((item) => adjustProps(item));
	} else {
		if (schemaPart.type === 'object' && schemaPart.properties && schemaPart.additionalProperties === false) {
			delete schemaPart.additionalProperties;
		}
		Object.values(schemaPart).forEach((item) => adjustProps(item));
	}
}

function transformTools(req: any) {
	let tools, tool_config;
	if (req.tools) {
		const funcs = req.tools.filter((tool: any) => tool.type === 'function' && tool.function?.name !== 'googleSearch');
		if (funcs.length > 0) {
			funcs.forEach(adjustSchema);
			tools = [{ function_declarations: funcs.map((schema: any) => schema.function) }];
		}
	}
	if (req.tool_choice) {
		const allowed_function_names = req.tool_choice?.type === 'function' ? [req.tool_choice?.name] : undefined;
		if (allowed_function_names || typeof req.tool_choice === 'string') {
			tool_config = {
				function_calling_config: {
					mode: allowed_function_names ? 'ANY' : req.tool_choice.toUpperCase(),
					allowed_function_names,
				},
			};
		}
	}
	return { tools, tool_config };
}

function parseThinkingParts(parts: any[]): { reasoningContent: string; finalContent: string } {
	let reasoningContent = '';
	let finalContent = '';
	for (const part of parts) {
		if (!part.text) continue;
		const isThought =
			part.thoughtToken ||
			part.thought ||
			part.thoughtTokens ||
			(part.executableCode && part.executableCode.language === 'thought');
		if (isThought) {
			reasoningContent += part.text;
		} else {
			finalContent += part.text;
		}
	}
	return { reasoningContent, finalContent };
}

async function transformRequest(req: any) {
	const safetySettings = HARM_CATEGORIES.map((category) => ({
		category,
		threshold: 'BLOCK_NONE',
	}));

	return {
		...(await transformMessages(req.messages)),
		safetySettings,
		generationConfig: transformConfig(req),
		...transformTools(req),
		cachedContent: undefined as any,
	};
}

// ─── GeminiProvider: Canonical IR → Gemini native ───

const GEMINI_REASONS_MAP: Record<string, string> = {
	STOP: 'stop',
	MAX_TOKENS: 'length',
	SAFETY: 'content_filter',
	RECITATION: 'content_filter',
};

export class GeminiProvider implements Provider {
	readonly type = 'gemini';
	private baseUrl: string;

	constructor(baseUrl?: string) {
		this.baseUrl = baseUrl?.replace(/\/+$/, '') || BASE_URL;
	}

	parseResponse(data: any, req: CanonicalRequest): CanonicalResponse {
		const id = 'chatcmpl-' + crypto.randomUUID().replace(/-/g, '').substring(0, 29);
		const model = data.modelVersion ?? req.model;

		return {
			id,
			model,
			choices: (data.candidates ?? []).map((cand: any) => {
				const { reasoningContent, finalContent } = parseThinkingParts(cand.content?.parts ?? []);
				// Extract functionCall from non-text, non-thinking parts
				const toolCalls: any[] = [];
				for (const part of cand.content?.parts ?? []) {
					if (part.functionCall) {
						toolCalls.push({
							id: 'call_' + crypto.randomUUID().replace(/-/g, '').substring(0, 24),
							type: 'function',
							function: {
								name: part.functionCall.name,
								arguments: typeof part.functionCall.args === 'string'
									? part.functionCall.args
									: JSON.stringify(part.functionCall.args ?? {}),
							},
						});
					}
				}
				return {
					index: cand.index || 0,
					message: {
						role: 'assistant' as const,
						content: finalContent || null,
						...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
						...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
					},
					finish_reason: toolCalls.length > 0 ? 'tool_calls' : (GEMINI_REASONS_MAP[cand.finishReason] || cand.finishReason),
				};
			}),
		};
	}

	parseStream(response: Response, req: CanonicalRequest): AsyncIterable<CanonicalStreamEvent> {
		return streamToCanonical(response, req);
	}

	async invoke(req: CanonicalRequest, ctx: ProviderContext): Promise<{ response: Response }> {
		const rawReq: any = {
			model: req.model,
			messages: req.messages,
			tools: req.tools,
			tool_choice: req.tool_choice,
			temperature: req.temperature,
			top_p: req.top_p,
			max_tokens: req.max_tokens,
			stream: req.stream,
			...(req.metadata as any),
		};

		let model = req.model?.startsWith('models/') ? req.model.substring(7) : req.model;

		let body = await transformRequest(rawReq);
		const extra = (req.metadata as any)?.extra_body?.google;
		if (extra) {
			if (extra.safety_settings) body.safetySettings = extra.safety_settings;
			if (extra.cached_content) body.cachedContent = extra.cached_content;
			if (extra.thinking_config) body.generationConfig.thinkingConfig = extra.thinking_config;
		}

		if (
			model.endsWith(':search') ||
			req.model.endsWith('-search-preview') ||
			req.tools?.some((tool: any) => tool.function?.name === 'googleSearch')
		) {
			if (model.endsWith(':search')) model = model.substring(0, model.length - 7);
			body.tools = body.tools || [];
			body.tools.push({ function_declarations: [{ name: 'googleSearch', parameters: {} }] });
		}

		const isStream = req.stream ?? false;
		const TASK = isStream ? 'streamGenerateContent' : 'generateContent';
		let url = `${this.baseUrl}/${API_VERSION}/models/${model}:${TASK}`;
		const query = new URLSearchParams(ctx.queryParams);
		if (isStream) query.set('alt', 'sse');
		const qs = query.toString();
		if (qs) url += '?' + qs;

		const baseHeaders: Record<string, string> = makeHeaders(ctx.apiKey, { 'Content-Type': 'application/json' }) as Record<string, string>;
		if (ctx.requestHeaders) {
			for (const [key, value] of ctx.requestHeaders.entries()) {
				const lower = key.toLowerCase();
				if (lower === 'content-type' || lower === 'x-goog-api-key') continue;
				baseHeaders[key] = value;
			}
		}

		const response = await fetch(url, {
			method: 'POST',
			headers: baseHeaders,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(120_000),
		});

		return { response };
	}
}

async function* streamToCanonical(response: Response, req: CanonicalRequest): AsyncIterable<CanonicalStreamEvent> {
	let lastTexts: Record<number, string> = {};
	let lastReasoning: Record<number, string> = {};
	let usage: { input_tokens?: number; output_tokens?: number } | undefined;

	for await (const json of streamSSELines(response, { timeoutMs: STREAM_TIMEOUT_MS })) {
		let parsed: any;
		try { parsed = JSON.parse(json); } catch { console.warn('[stream] Invalid JSON chunk:', json); continue; }

		if (parsed.usageMetadata) {
			usage = { input_tokens: parsed.usageMetadata.promptTokenCount, output_tokens: parsed.usageMetadata.candidatesTokenCount };
		}

		if (parsed.candidates) {
			for (const cand of parsed.candidates) {
				const { index, content, finishReason } = cand;
				const parts = content?.parts ?? [];
				const { reasoningContent, finalContent } = parseThinkingParts(parts);

				if (reasoningContent) {
					const last = lastReasoning[index] || '';
					const delta = reasoningContent.length > last.length ? reasoningContent.substring(last.length) : reasoningContent;
					lastReasoning[index] = reasoningContent;
					if (delta) yield { type: 'reasoning_delta', text: delta };
				}

				if (finalContent) {
					const last = lastTexts[index] || '';
					const delta = finalContent.length > last.length ? finalContent.substring(last.length) : finalContent;
					lastTexts[index] = finalContent;
					if (delta) yield { type: 'text_delta', text: delta };
				}

				// Emit tool_call_delta for functionCall parts in streaming
				for (const part of parts) {
					if (part.functionCall) {
						yield { type: 'tool_call_delta', id: '', index: cand.index, name: part.functionCall.name, argumentsDelta: JSON.stringify(part.functionCall.args ?? {}) };
					}
				}

				if (finishReason) {
					const fr = parts.some((p: any) => p.functionCall) ? 'tool_calls' : (GEMINI_REASONS_MAP[finishReason] || finishReason);
					yield { type: 'done', finishReason: fr, usage };
				}
			}
		}
	}
}
