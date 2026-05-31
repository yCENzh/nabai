import { Hono } from 'hono';
import { Render } from './render';
import { LoadBalancer } from './handler';
import { getAuthKey } from './auth';
import { getCookie, setCookie } from 'hono/cookie';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
	const sessionKey = getCookie(c, 'auth-key');
	const authKey = getAuthKey(c.req.raw, sessionKey);
	if (authKey !== c.env.HOME_ACCESS_KEY) {
		return c.html(Render({ isAuthenticated: false, showWarning: false }));
	}
	const showWarning =
		c.env.HOME_ACCESS_KEY === '08579ef49716b41562fbfe0b7e15d968cd816421604ee58fb706033ebde4ac14' || c.env.AUTH_KEY === 'nabai';
	return c.html(Render({ isAuthenticated: true, showWarning }));
});

app.post('/', async (c) => {
	const { key } = await c.req.json();
	if (key === c.env.HOME_ACCESS_KEY) {
		setCookie(c, 'auth-key', key, { maxAge: 60 * 60 * 24 * 30, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' });
		return c.json({ success: true });
	}
	return c.json({ success: false }, 401);
});

app.get('/favicon.ico', async (c) => {
	return c.text('Not found', 404);
});

app.all('*', async (c) => {
	const id: DurableObjectId = c.env.LOAD_BALANCER.idFromName('loadbalancer');
	const stub = c.env.LOAD_BALANCER.get(id, { locationHint: 'wnam' });
	const resp = await stub.fetch(c.req.raw);
	return new Response(resp.body, {
		status: resp.status,
		headers: resp.headers,
	});
});

type Env = {
	LOAD_BALANCER: DurableObjectNamespace<LoadBalancer>;
	AUTH_KEY: string;
	HOME_ACCESS_KEY: string;
};

export default {
	fetch: app.fetch,
};

export { LoadBalancer };
