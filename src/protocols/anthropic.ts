import { HttpError } from '../core/utils';
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../core/types';
import type { ProtocolAdapter } from './base';

export class AnthropicProtocolAdapter implements ProtocolAdapter {
	readonly protocol = 'anthropic';

	async parseRequest(request: Request, opts: { requestId: string }): Promise<CanonicalRequest> {
		const body: any = await request.json();

		if (!body.model || typeof body.model !== 'string') {
			throw new HttpError('model is required', 400);
		}

		// Anthropic puts system as a top-level field, not in messages
		const messages: CanonicalRequest['messages'] = [];
		if (body.system) {
			const systemContent = typeof body.system === 'string'
				? body.system
				: body.system.map((b: any) => b.text || '').join('\n');
			messages!.push({ role: 'system', content: systemContent });
		}

		for (const msg of body.messages ?? []) {
			const content: any[] = [];
			if (typeof msg.content === 'string') {
				content.push({ type: 'text', text: msg.content });
			} else if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === 'text') {
						content.push({ type: 'text', text: block.text });
					} else if (block.type === 'image') {
						content.push({
							type: 'image_url',
							url: block.source?.type === 'base64'
								? `data:${block.source.media_type};base64,${block.source.data}`
								: block.source?.url ?? '',
						});
					} else if (block.type === 'tool_use') {
						content.push({ type: 'input_json', json: { id: block.id, name: block.name, arguments: block.input } });
					} else if (block.type === 'tool_result') {
						content.push({ type: 'input_json', json: { tool_call_id: block.tool_use_id, result: block.content } });
					}
				}
			}
			messages!.push({
				role: msg.role === 'assistant' ? 'assistant' : 'user',
				content,
			});
		}

		// Convert Anthropic tools to canonical format
		const tools = body.tools?.map((t: any) => ({
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema,
			},
		}));

		return {
			requestId: opts.requestId,
			model: body.model,
			messages,
			tools,
			max_tokens: body.max_tokens,
			temperature: body.temperature,
			top_p: body.top_p,
			stream: body.stream ?? false,
			metadata: {
				anthropic_version: body.anthropic_version,
				thinking: body.thinking,
				tool_choice: body.tool_choice,
			},
		};
	}

	renderJson(response: CanonicalResponse, opts: { requestId: string }): Response {
		const content: any[] = [];
		for (const choice of response.choices) {
			if (choice.message.content) {
				content.push({ type: 'text', text: choice.message.content });
			}
			if (choice.message.reasoning_content) {
				content.push({ type: 'thinking', thinking: choice.message.reasoning_content });
			}
		}

		const body = {
			id: opts.requestId,
			type: 'message',
			role: 'assistant',
			content,
			model: response.model,
			stop_reason: mapFinishReason(response.choices[0]?.finish_reason),
		};

		return new Response(JSON.stringify(body), {
			headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
		});
	}

	renderStream(events: AsyncIterable<CanonicalStreamEvent>, opts: { requestId: string }): Response {
		const encoder = new TextEncoder();
		let contentIndex = 0;
		let hasThinking = false;
		let hasText = false;

		const stream = new ReadableStream({
			async start(controller) {
				const send = (event: string, data: any) => {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				};

				// message_start
				send('message_start', {
					type: 'message_start',
					message: {
						id: opts.requestId,
						type: 'message',
						role: 'assistant',
						content: [],
						model: '',
						stop_reason: null,
					},
				});

				try {
					for await (const event of events) {
						if (event.type === 'reasoning_delta') {
							if (!hasThinking) {
								hasThinking = true;
								send('content_block_start', {
									type: 'content_block_start',
									index: contentIndex,
									content_block: { type: 'thinking', thinking: '' },
								});
							}
							send('content_block_delta', {
								type: 'content_block_delta',
								index: contentIndex,
								delta: { type: 'thinking_delta', thinking: event.text },
							});
						} else if (event.type === 'text_delta') {
							if (hasThinking) {
								send('content_block_stop', { type: 'content_block_stop', index: contentIndex });
								contentIndex++;
								hasThinking = false;
							}
							if (!hasText) {
								hasText = true;
								send('content_block_start', {
									type: 'content_block_start',
									index: contentIndex,
									content_block: { type: 'text', text: '' },
								});
							}
							send('content_block_delta', {
								type: 'content_block_delta',
								index: contentIndex,
								delta: { type: 'text_delta', text: event.text },
							});
						} else if (event.type === 'done') {
							if (hasThinking) {
								send('content_block_stop', { type: 'content_block_stop', index: contentIndex });
								contentIndex++;
								hasThinking = false;
							} else if (contentIndex > 0) {
								send('content_block_stop', { type: 'content_block_stop', index: contentIndex });
							}

							send('message_delta', {
								type: 'message_delta',
								delta: {
									stop_reason: mapFinishReason(event.finishReason),
									stop_sequence: null,
								},
							});
							send('message_stop', { type: 'message_stop' });
						} else if (event.type === 'error') {
							send('error', {
								type: 'error',
								error: { type: 'api_error', message: event.message },
							});
						}
					}
				} catch (err) {
					send('error', {
						type: 'error',
						error: { type: 'api_error', message: String(err) },
					});
				}

				controller.close();
			},
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'Access-Control-Allow-Origin': '*',
			},
		});
	}

	renderError(err: unknown, opts: { requestId: string }): Response {
		const status = err instanceof HttpError ? err.status : 500;
		const message = err instanceof Error ? err.message : 'Internal Server Error';
		const errorType = status === 400 ? 'invalid_request_error'
			: status === 401 ? 'authentication_error'
			: status === 429 ? 'rate_limit_error'
			: 'api_error';

		return new Response(
			JSON.stringify({
				type: 'error',
				error: { type: errorType, message },
			}),
			{ status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
		);
	}
}

function mapFinishReason(reason?: string): string {
	switch (reason) {
		case 'stop': return 'end_turn';
		case 'length': return 'max_tokens';
		case 'content_filter': return 'end_turn';
		default: return reason ?? 'end_turn';
	}
}
