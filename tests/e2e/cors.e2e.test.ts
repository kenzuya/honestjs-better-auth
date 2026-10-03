import { describe, expect, it } from "bun:test";
import request from "../shared/request.ts";
import { createTestApp } from "../shared/test-utils.ts";

const TRUSTED_ORIGIN = "http://localhost:3000";
const UNTRUSTED_ORIGIN = "http://evil.example.com";

describe("cors e2e", () => {
	it("should apply trustedOrigins CORS headers on Better Auth routes", async () => {
		const testSetup = await createTestApp(undefined, {
			authOptions: {
				trustedOrigins: [TRUSTED_ORIGIN],
			},
		});

		const optionsResponse = await request(testSetup.hono)
			.options("/api/auth/sign-in/email")
			.set("Origin", TRUSTED_ORIGIN)
			.set("Access-Control-Request-Method", "POST")
			.set("Access-Control-Request-Headers", "content-type, stripe-signature");

		expect(optionsResponse.status).toBe(204);
		expect(optionsResponse.headers["access-control-allow-origin"]).toBe(
			TRUSTED_ORIGIN,
		);
		expect(optionsResponse.headers["access-control-allow-credentials"]).toBe(
			"true",
		);
		expect(
			optionsResponse.headers["access-control-allow-headers"]
				?.split(",")
				.map((header) => header.trim()),
		).toEqual(["content-type", "stripe-signature"]);

		const okResponse = await request(testSetup.hono)
			.get("/api/auth/ok")
			.set("Origin", TRUSTED_ORIGIN);

		expect(okResponse.status).toBe(200);
		expect(okResponse.headers["access-control-allow-origin"]).toBe(
			TRUSTED_ORIGIN,
		);
		expect(okResponse.headers["access-control-allow-credentials"]).toBe("true");
	});

	it("should not allow origins outside trustedOrigins", async () => {
		const testSetup = await createTestApp(undefined, {
			authOptions: {
				trustedOrigins: [TRUSTED_ORIGIN],
			},
		});

		const okResponse = await request(testSetup.hono)
			.get("/api/auth/ok")
			.set("Origin", UNTRUSTED_ORIGIN);

		expect(okResponse.status).toBe(200);
		expect(okResponse.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("should evaluate function-based trustedOrigins with the request", async () => {
		const requests: Request[] = [];
		const testSetup = await createTestApp(undefined, {
			authOptions: {
				trustedOrigins: async (req) => {
					if (req) requests.push(req);
					return [TRUSTED_ORIGIN];
				},
			},
		});

		const okResponse = await request(testSetup.hono)
			.get("/api/auth/ok")
			.set("Origin", TRUSTED_ORIGIN);

		expect(okResponse.status).toBe(200);
		expect(okResponse.headers["access-control-allow-origin"]).toBe(
			TRUSTED_ORIGIN,
		);
		expect(requests.length).toBeGreaterThan(0);
		expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/auth/ok");
	});

	it("should not apply CORS to the application's own routes", async () => {
		const testSetup = await createTestApp(undefined, {
			authOptions: {
				trustedOrigins: [TRUSTED_ORIGIN],
			},
		});

		const response = await request(testSetup.hono)
			.get("/test/public")
			.set("Origin", TRUSTED_ORIGIN);

		expect(response.status).toBe(200);
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("should not add Better Auth route CORS when disableTrustedOriginsCors is true", async () => {
		const testSetup = await createTestApp(
			{
				disableTrustedOriginsCors: true,
			},
			{
				authOptions: {
					trustedOrigins: [TRUSTED_ORIGIN],
				},
			},
		);

		const okResponse = await request(testSetup.hono)
			.get("/api/auth/ok")
			.set("Origin", TRUSTED_ORIGIN);

		expect(okResponse.status).toBe(200);
		expect(okResponse.headers["access-control-allow-origin"]).toBeUndefined();
		expect(
			okResponse.headers["access-control-allow-credentials"],
		).toBeUndefined();
	});
});
