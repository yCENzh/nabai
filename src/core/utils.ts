export class HttpError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = this.constructor.name;
		this.status = status;
	}
}

export const fixCors = ({ headers, status, statusText }: { headers?: HeadersInit; status?: number; statusText?: string }) => {
	const newHeaders = new Headers(headers);
	newHeaders.set('Access-Control-Allow-Origin', '*');
	newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, x-api-key, anthropic-version');
	return { headers: newHeaders, status, statusText };
};

export const BASE_URL = 'https://generativelanguage.googleapis.com';
export const API_VERSION = 'v1beta';
export const API_CLIENT = 'genai-js/0.21.0';

export const makeHeaders = (apiKey: string, more?: Record<string, string>) => ({
	'x-goog-api-client': API_CLIENT,
	...(apiKey && { 'x-goog-api-key': apiKey }),
	...more,
});

export function generateId(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(29);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => characters[b % characters.length]).join('');
}

export function maskKey(key: string): string {
	if (!key || key.length < 8) return '****';
	return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
