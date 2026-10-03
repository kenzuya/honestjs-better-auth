import type { Hono } from "hono";

/**
 * Response shape of the request helper, modelled on supertest's.
 */
export interface TestResponse {
	status: number;
	headers: Record<string, string>;
	// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON bodies
	body: any;
	text: string;
}

type Expectation = number | ((response: TestResponse) => void);

/**
 * Minimal supertest-style request builder that runs requests in-process through `hono.request()`.
 */
class TestRequest implements PromiseLike<TestResponse> {
	private readonly headers = new Headers();
	private readonly expectations: Expectation[] = [];
	private body: string | undefined;
	private contentType: "json" | "form" = "json";

	constructor(
		private readonly hono: Hono,
		private readonly method: string,
		private readonly path: string,
	) {}

	set(name: string, value: string): this {
		this.headers.set(name, value);
		return this;
	}

	type(type: "json" | "form"): this {
		this.contentType = type;
		return this;
	}

	send(data: unknown): this {
		if (typeof data === "string") {
			this.body = data;
			return this;
		}

		if (this.contentType === "form") {
			this.body = new URLSearchParams(
				data as Record<string, string>,
			).toString();
			if (!this.headers.has("Content-Type"))
				this.headers.set("Content-Type", "application/x-www-form-urlencoded");
			return this;
		}

		this.body = JSON.stringify(data);
		if (!this.headers.has("Content-Type"))
			this.headers.set("Content-Type", "application/json");
		return this;
	}

	expect(expectation: Expectation): this {
		this.expectations.push(expectation);
		return this;
	}

	// biome-ignore lint/suspicious/noThenProperty: awaitable like supertest's request builder
	then<TResult1 = TestResponse, TResult2 = never>(
		onfulfilled?:
			| ((value: TestResponse) => TResult1 | PromiseLike<TResult1>)
			| null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
	): PromiseLike<TResult1 | TResult2> {
		return this.execute().then(onfulfilled, onrejected);
	}

	private async execute(): Promise<TestResponse> {
		const res = await this.hono.request(`http://localhost${this.path}`, {
			method: this.method,
			headers: this.headers,
			body: this.body,
		});

		const text = await res.text();
		const isJson = res.headers.get("content-type")?.includes("json");
		const response: TestResponse = {
			status: res.status,
			headers: Object.fromEntries(res.headers.entries()),
			body: isJson && text ? JSON.parse(text) : {},
			text,
		};

		for (const expectation of this.expectations) {
			if (typeof expectation === "function") {
				expectation(response);
			} else if (response.status !== expectation) {
				throw new Error(
					`expected ${expectation}, got ${response.status} for ${this.method} ${this.path}: ${text}`,
				);
			}
		}

		return response;
	}
}

export default function request(hono: Hono) {
	return {
		get: (path: string) => new TestRequest(hono, "GET", path),
		post: (path: string) => new TestRequest(hono, "POST", path),
		put: (path: string) => new TestRequest(hono, "PUT", path),
		delete: (path: string) => new TestRequest(hono, "DELETE", path),
		options: (path: string) => new TestRequest(hono, "OPTIONS", path),
	};
}
