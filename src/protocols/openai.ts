import { HttpError } from '../core/utils';
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../canonical/types';
import type { ProtocolAdapter } from '../canonical/adapter';

export class OpenAIProtocolAdapter implements ProtocolAdapter {
	readonly protocol = 'openai';

	async parseRequest(request: Request, opts: { requestId: string }): Promise<CanonicalRequest> {
		const body: any = await request.json();

		if (!body.model || typeof body.model !== 'string') {
			throw new HttpError('model is required', 400);
		}

		const metadata = { ...body };
		delete metadata.model;
		delete metadata.messages;
		delete metadata.tools;
		delete metadata.tool_choice;
		delete metadata.temperature;
		delete metadata.top_p;
		delete metadata.max_tokens;
		delete metadata.max_completion_tokens;
		delete metadata.stream;

		// Normalize OpenAI tool_choice format to canonical {@type function; name}
		let tool_choice: CanonicalRequest['tool_choice'];
		if (body.tool_choice) {
			if (typeof body.tool_choice === 'string') {
				tool_choice = body.tool_choice;
			} else if (body.tool_choice?.function?.name) {
				// OpenAI format: { type: "function", function: { name: "..." } }
				tool_choice = { type: 'function', name: body.tool_choice.function.name };
			} else {
				tool_choice = body.tool_choice;
			}
		}

		return {
			requestId: opts.requestId,
			model: body.model,
			messages: body.messages,
			tools: body.tools,
			tool_choice,
			temperature: body.temperature,
			top_p: body.top_p,
			max_tokens: body.max_tokens ?? body.max_completion_tokens,
			stream: body.stream ?? false,
			metadata,
		};
	}

	renderJson(response: CanonicalResponse, opts: { requestId: string }): Response {
		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
		});
	}

	renderStream(events: AsyncIterable<CanonicalStreamEvent>, opts: { requestId: string; model?: string }): Response {
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				let doneSent = false;
				try {
					for await (const event of events) {
						if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
							controller.enqueue(encoder.encode(event.type === 'reasoning_delta'
								? `data: ${JSON.stringify({ id: opts.requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: opts.model ?? '', choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }] })}\n\n`
								: `data: ${JSON.stringify({ id: opts.requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: opts.model ?? '', choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }] })}\n\n`
							));
						} else if (event.type === 'tool_call_delta') {
							const tc: any = { index: event.index ?? 0 };
							if (event.id) { tc.id = event.id; tc.type = 'function'; }
							if (event.name) tc.function = { name: event.name, arguments: event.argumentsDelta ?? '' };
							else if (event.argumentsDelta) tc.function = { arguments: event.argumentsDelta };
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: opts.requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: opts.model ?? '', choices: [{ index: 0, delta: { tool_calls: [tc] }, finish_reason: null }] })}\n\n`));
						} else if (event.type === 'done') {
							doneSent = true;
							const finalChunk: any = {
								id: opts.requestId, object: 'chat.completion.chunk',
								created: Math.floor(Date.now() / 1000), model: opts.model ?? '',
								choices: [{ index: 0, delta: {}, finish_reason: event.finishReason ?? 'stop' }],
							};
							if (event.usage) {
								finalChunk.usage = {
									prompt_tokens: event.usage.input_tokens ?? 0,
									completion_tokens: event.usage.output_tokens ?? 0,
									total_tokens: (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0),
								};
							}
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
							controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						} else if (event.type === 'error') {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: event.message, type: 'server_error', code: event.code } })}\n\n`));
						}
					}
				} catch (err) {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: String(err), type: 'server_error' } })}\n\n`));
				}
				if (!doneSent) {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: opts.requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: opts.model ?? '', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`));
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
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
		return new Response(
			JSON.stringify({ error: { message, type: 'server_error', code: status } }),
			{ status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
		);
	}
}
