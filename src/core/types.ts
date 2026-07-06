export interface CanonicalMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | ContentBlock[];
	name?: string;
	tool_call_id?: string;
	tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string; detail?: string } }
	| { type: 'input_audio'; input_audio: { format: string; data: string } }
	| { type: 'input_json'; json: { id?: string; name?: string; arguments?: unknown; tool_call_id?: string; result?: unknown } };

export interface CanonicalTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface CanonicalRequest {
	requestId: string;
	model: string;
	messages?: CanonicalMessage[];
	tools?: CanonicalTool[];
	tool_choice?: 'auto' | 'none' | { type: 'function'; name: string };
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	stream?: boolean;
	metadata?: Record<string, unknown>;
}

export type CanonicalStreamEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'reasoning_delta'; text: string }
	| { type: 'tool_call_delta'; id: string; index?: number; name?: string; argumentsDelta?: string }
	| { type: 'done'; finishReason?: string; usage?: { input_tokens?: number; output_tokens?: number } }
	| { type: 'error'; code: string; message: string; retryable?: boolean };

export interface CanonicalResponse {
	id: string;
	model: string;
	choices: Array<{
		index: number;
		message: { role: string; content: string | null; reasoning_content?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> };
		finish_reason: string;
	}>;
}
