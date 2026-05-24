import { HttpError } from '../core/utils';
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../core/types';
import type { ProtocolAdapter } from './base';

export class OpenAIProtocolAdapter implements ProtocolAdapter {
	readonly protocol = 'openai';

	async parseRequest(request: Request, opts: { requestId: string }): Promise<CanonicalRequest> {
		const body: any = await request.json();

		if (!body.model || typeof body.model !== 'string') {
			throw new HttpError('model is required', 400);
		}

		return {
			requestId: opts.requestId,
			model: body.model,
			messages: body.messages,
			tools: body.tools,
			tool_choice: body.tool_choice,
			temperature: body.temperature,
			top_p: body.top_p,
			max_tokens: body.max_tokens ?? body.max_completion_tokens,
			stream: body.stream ?? false,
			metadata: {
				stream_options: body.stream_options,
				extra_body: body.extra_body,
				response_format: body.response_format,
				reasoning_effort: body.reasoning_effort,
				frequency_penalty: body.frequency_penalty,
				presence_penalty: body.presence_penalty,
				n: body.n,
				seed: body.seed,
				stop: body.stop,
				top_k: body.top_k,
			},
		};
	}

	renderJson(response: CanonicalResponse, opts: { requestId: string }): Response {
		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
		});
	}

	renderStream(events: AsyncIterable<CanonicalStreamEvent>, opts: { requestId: string }): Response {
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				let doneSent = false;
				try {
					for await (const event of events) {
						if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
							controller.enqueue(encoder.encode(event.type === 'reasoning_delta'
								? `data: ${JSON.stringify({ id: opts.requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: '', choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }] })}\n\n`
								: `data: ${JSON.stringify({ id: opts.requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: '', choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }] })}\n\n`
							));
						} else if (event.type === 'done') {
							doneSent = true;
							controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						} else if (event.type === 'error') {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: event.message, type: 'server_error', code: event.code } })}\n\n`));
						}
					}
				} catch (err) {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: String(err), type: 'server_error' } })}\n\n`));
				}
				if (!doneSent) {
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
