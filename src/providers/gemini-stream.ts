import { parseThinkingParts, GEMINI_REASONS_MAP } from './gemini';

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

export function parseStreamFlush(this: any, controller: any) {
	if (this.buffer) {
		const trimmed = this.buffer.trim();
		if (trimmed.startsWith('data: ')) {
			const data = trimmed.substring(6);
			if (data.startsWith('{')) {
				try {
					controller.enqueue(JSON.parse(data));
					this.shared.is_buffers_rest = true;
				} catch (e) {
					console.error('Error parsing remaining buffer:', e);
				}
			}
		} else if (trimmed.startsWith('{')) {
			try {
				controller.enqueue(JSON.parse(trimmed));
				this.shared.is_buffers_rest = true;
			} catch (e) {
				console.error('Error parsing remaining buffer:', e);
			}
		}
	}
}

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
				const reasoningDelta = reasoningText.length > lastReasoningText.length ? reasoningText.substring(lastReasoningText.length) : reasoningText;
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
				const delta = finalText.length > lastText.length ? finalText.substring(lastText.length) : finalText;
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

export function toOpenAiStreamFlush(this: any, controller: any) {
	controller.enqueue('data: [DONE]\n\n');
}
