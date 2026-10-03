import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import request from "../shared/request.ts";
import { createTestApp } from "../shared/test-utils.ts";

describe("options e2e", () => {
	it("should not find any auth routes if disableControllers is set", async () => {
		const testSetup = await createTestApp({ disableControllers: true });

		const signUpResponse = await request(testSetup.hono)
			.post("/api/auth/sign-up/email")
			.send({
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			});

		const signInResponse = await request(testSetup.hono)
			.post("/api/auth/sign-in/email")
			.send({
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			});

		expect(signUpResponse.status).toBe(404);
		expect(signInResponse.status).toBe(404);
	});

	it("should keep guarding routes when disableControllers is set", async () => {
		const testSetup = await createTestApp({ disableControllers: true });

		const signUp = await testSetup.auth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			},
		});

		await request(testSetup.hono).get("/test/protected").expect(401);
		await request(testSetup.hono)
			.get("/test/protected")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);
	});

	it("should gracefully handling a middleware throwing an uncaught error", async () => {
		const testSetup = await createTestApp({
			middleware: () => {
				throw new Error("uncaught");
			},
		});

		const response = await request(testSetup.hono).get("/api/auth/ok");

		expect(response.status).toBe(500);
		expect(response.body).toMatchObject({
			status: 500,
			path: "/api/auth/ok",
		});
	});

	it("should run the middleware before the Better Auth handler", async () => {
		const calls: string[] = [];
		const testSetup = await createTestApp({
			middleware: async (c, next) => {
				calls.push(c.req.path);
				await next();
				c.res.headers.set("x-auth-middleware", "1");
			},
		});

		const response = await request(testSetup.hono)
			.get("/api/auth/ok")
			.expect(200);

		expect(calls).toEqual(["/api/auth/ok"]);
		expect(response.headers["x-auth-middleware"]).toBe("1");
		expect(response.body).toEqual({ ok: true });
	});

	it("should let the middleware answer instead of Better Auth", async () => {
		const testSetup = await createTestApp({
			middleware: async (c) => c.json({ blocked: true }, 403),
		});

		const response = await request(testSetup.hono)
			.get("/api/auth/ok")
			.expect(403);

		expect(response.body).toEqual({ blocked: true });
	});

	it("should leave request bodies of non-auth routes readable", async () => {
		const testSetup = await createTestApp();

		const response = await request(testSetup.hono)
			.post("/test/json-body")
			.send({ test: "data" })
			.expect(200);

		expect(response.body).toEqual({
			hasBody: true,
			body: { test: "data" },
		});
	});

	it("should honor a custom Better Auth basePath", async () => {
		const testSetup = await createTestApp(undefined, {
			authOptions: { basePath: "/auth/" },
		});

		await request(testSetup.hono).get("/auth/ok").expect(200);
		await request(testSetup.hono).get("/api/auth/ok").expect(404);
	});
});
