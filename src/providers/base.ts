import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../canonical/types';

export interface ProviderContext {
	apiKey: string;
	requestHeaders?: Headers;
	queryParams?: URLSearchParams;
	signal?: AbortSignal;
}

export interface Provider {
	readonly type: string;

	/** Invoke the provider and return raw response */
	invoke(req: CanonicalRequest, ctx: ProviderContext): Promise<{ response: Response }>;

	/** Parse non-streaming response to CanonicalResponse */
	parseResponse(data: any, req: CanonicalRequest): CanonicalResponse;

	/** Wrap streaming response as AsyncIterable<CanonicalStreamEvent> */
	parseStream(response: Response, req: CanonicalRequest): AsyncIterable<CanonicalStreamEvent>;
}
