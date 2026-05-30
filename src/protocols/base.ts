import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../core/types';

export interface ProtocolAdapter {
	readonly protocol: string;

	/** Parse inbound request into CanonicalRequest */
	parseRequest(request: Request, opts: { requestId: string }): Promise<CanonicalRequest>;

	/** Render non-streaming response */
	renderJson(response: CanonicalResponse, opts: { requestId: string }): Response;

	/** Render streaming response from async iterable of events */
	renderStream(events: AsyncIterable<CanonicalStreamEvent>, opts: { requestId: string; model?: string }): Response;

	/** Render error in protocol-native format */
	renderError(err: unknown, opts: { requestId: string }): Response;
}
