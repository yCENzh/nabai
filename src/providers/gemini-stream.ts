import { parseThinkingParts, GEMINI_REASONS_MAP } from './gemini';

/** SSE parser: accumulates text chunks, emits parsed JSON objects */
export function parseStream(this: any, chunk: string, controller: any) {
	this.buffer += chunk;
	const lines = this.buffer.split('\n');
	this.buffer = lines.pop()!;

	for (const line of lines) {
		if (line.startsWith('data: ')) {
			const data = line.substring(6);
			if (data.startsWith('{')) {
				controller.enqueue(data);
			}
		}
	}
}

/** SSE parser flush: handle remaining buffer */
export function parseStreamFlush(this: any, controller: any) {
	if (this.buffer) {
		try {
			controller.enqueue(JSON.parse(this.buffer));
			this.shared.is_buffers_rest = true;
		} catch (e) {
			console.error('Error parsing remaining buffer:', e);
		}
	}
}

/** Convert parsed Gemini JSON to OpenAI SSE chunks */
export function toOpenAiStream(this: any, line: any, controller: any) {
	const { candidates } = line;
	if (candidates) {
		for (const cand of candidates) {
			const { index, content, finishReason } = cand;
			const { parts } = content;

			const { reasoningContent: reasoningText, finalContent: finalText } = parseThinkingParts(parts);

			if (reasoningText) {
				if (!this.reasoningLast) this.reasoningLast = {};
				if (this.reasoningLast[index] === undefined) {
					this.reasoningLast[index] = '';
				}

				const lastReasoningText = this.reasoningLast[index] || '';
				let reasoningDelta = '';

				if (reasoningText.startsWith(lastReasoningText)) {
					reasoningDelta = reasoningText.substring(lastReasoningText.length);
				} else {
					let i = 0;
					while (i < reasoningText.length && i < lastReasoningText.length && reasoningText[i] === lastReasoningText[i]) {
						i++;
					}
					reasoningDelta = reasoningText.substring(i);
				}

				this.reasoningLast[index] = reasoningText;

				if (reasoningDelta) {
					const reasoningObj = {
						id: this.id,
						object: 'chat.completion.chunk',
						created: Math.floor(Date.now() / 1000),
						model: this.model,
						choices: [
							{
								index,
								delta: { reasoning_content: reasoningDelta },
								finish_reason: null,
							},
						],
					};
					controller.enqueue(`data: ${JSON.stringify(reasoningObj)}\n\n`);
				}
			}

			if (finalText) {
				if (this.last[index] === undefined) {
					this.last[index] = '';
				}

				const lastText = this.last[index] || '';
				let delta = '';

				if (finalText.startsWith(lastText)) {
					delta = finalText.substring(lastText.length);
				} else {
					let i = 0;
					while (i < finalText.length && i < lastText.length && finalText[i] === lastText[i]) {
						i++;
					}
					delta = finalText.substring(i);
				}

				this.last[index] = finalText;

				if (delta) {
					const obj = {
						id: this.id,
						object: 'chat.completion.chunk',
						created: Math.floor(Date.now() / 1000),
						model: this.model,
						choices: [
							{
								index,
								delta: { content: delta },
								finish_reason: null,
							},
						],
					};
					controller.enqueue(`data: ${JSON.stringify(obj)}\n\n`);
				}
			}

			if (finishReason) {
				const finishObj = {
					id: this.id,
					object: 'chat.completion.chunk',
					created: Math.floor(Date.now() / 1000),
					model: this.model,
					choices: [
						{
							index,
							delta: {},
							finish_reason: GEMINI_REASONS_MAP[finishReason] || finishReason,
						},
					],
				};
				controller.enqueue(`data: ${JSON.stringify(finishObj)}\n\n`);
			}
		}
	}
}

/** Final flush: emit [DONE] */
export function toOpenAiStreamFlush(this: any, controller: any) {
	controller.enqueue('data: [DONE]\n\n');
}
