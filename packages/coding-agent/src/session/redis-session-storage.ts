// Stub: Redis session storage removed upstream — not used by fork
export class RedisSessionStorage {
	static async create() {
		return new RedisSessionStorage();
	}
}
