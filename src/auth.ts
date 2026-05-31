export function getAuthKey(request: Request, sessionKey?: string): string | undefined {
    if (sessionKey) return sessionKey;
    const cookie = request.headers.get('Cookie');
    if (cookie) {
        const match = cookie.match(/(?:^|;\s*)auth-key=([^;]+)/);
        if (match) { try { return decodeURIComponent(match[1]); } catch { return match[1]; } }
    }
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
        return authHeader.replace(/^Bearer\s+/, '');
    }
    return undefined;
}

export function isAdminAuthenticated(request: Request, homeAccessKey: string): boolean {
    if (!homeAccessKey) return false;
    const key = getAuthKey(request);
    return key === homeAccessKey;
}
