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

export const STREAM_TIMEOUT_MS = 300_000; // 5 min

/**
 * 从 SSE (Server-Sent Events) 响应中逐行提取 `data: {json}` 的 JSON 内容。
 * 处理 buffer 拼接、超时、尾部残留数据。
 * 自动过滤掉非 JSON 行和 `data: [DONE]` 行。
 */
export async function* streamSSELines(
	response: Response,
	options?: { timeoutMs?: number }
): AsyncGenerator<string, void, void> {
	const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';

	while (true) {
		let timedOut = false;
		let timerId: ReturnType<typeof setTimeout> | undefined;
		const result = options?.timeoutMs
			? await Promise.race([
					reader.read(),
					new Promise<{ done: true; value: undefined }>(r => {
						timerId = setTimeout(() => { timedOut = true; r({ done: true, value: undefined }); }, options.timeoutMs!);
					}),
			  ])
			: await reader.read();
		if (timerId && !timedOut) clearTimeout(timerId);
		if (result.done) {
			// 超时触发时 reader.read() 仍在 pending，需释放 reader 锁
			// 否则 reader 无法被 GC 回收，底层 HTTP 连接也无法取消
			if (timedOut) {
				try { reader.cancel(); } catch { /* reader 已关闭 */ }
			}
			break;
		}
		buffer += result.value;
		const lines = buffer.split('\n');
		buffer = lines.pop()!;

		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.substring(6).trim();
			if (!data.startsWith('{')) continue;
			yield data;
		}
	}

	// 尾部：处理缓冲区中可能残留的最后一行
	if (buffer) {
		const lines = (buffer + '\n').split('\n');
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const data = line.substring(6).trim();
			if (!data.startsWith('{')) continue;
			yield data;
		}
	}
}
