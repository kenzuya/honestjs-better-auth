import "reflect-metadata";
import { beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { Service, type Application } from "@kenzuya/honest";
import type { Hono } from "hono";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { DatabaseHook, BeforeCreate, AfterCreate } from "../../src/index.ts";
import request from "../shared/request.ts";
import { createAuthTestApp } from "../shared/test-utils.ts";

@Service()
class DatabaseHookTrackerService {
	calls: { hook: string; model: string; operation: string }[] = [];

	track(hook: string, model: string, operation: string) {
		this.calls.push({ hook, model, operation });
	}

	getCalls(hook: string, model: string, operation: string) {
		return this.calls.filter(
			(c) => c.hook === hook && c.model === model && c.operation === operation,
		);
	}
}

@DatabaseHook()
@Service()
class UserDatabaseHook {
	constructor(private readonly tracker: DatabaseHookTrackerService) {}

	@BeforeCreate("user")
	async beforeCreate() {
		this.tracker.track("before", "user", "create");
	}

	@AfterCreate("user")
	async afterCreate() {
		this.tracker.track("after", "user", "create");
	}
}

@DatabaseHook()
@Service()
class SessionDatabaseHook {
	constructor(private readonly tracker: DatabaseHookTrackerService) {}

	@AfterCreate("session")
	async afterCreate() {
		this.tracker.track("after", "session", "create");
	}
}

describe("database hooks e2e", () => {
	let app: Application;
	let hono: Hono;

	beforeAll(async () => {
		const auth = betterAuth({
			basePath: "/api/auth",
			emailAndPassword: { enabled: true },
			plugins: [bearer()],
			databaseHooks: {},
		});

		({ app, hono } = await createAuthTestApp(auth, {
			services: [
				DatabaseHookTrackerService,
				UserDatabaseHook,
				SessionDatabaseHook,
			],
		}));
	});

	it("should call @BeforeCreate('user') on sign-up", async () => {
		const tracker = app.getContainer().resolve(DatabaseHookTrackerService);
		const before = tracker.getCalls("before", "user", "create").length;

		await request(hono)
			.post("/api/auth/sign-up/email")
			.set("Content-Type", "application/json")
			.send({
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			})
			.expect(200);

		expect(tracker.getCalls("before", "user", "create").length).toBe(
			before + 1,
		);
	});

	it("should call @AfterCreate('user') on sign-up", async () => {
		const tracker = app.getContainer().resolve(DatabaseHookTrackerService);
		const before = tracker.getCalls("after", "user", "create").length;

		await request(hono)
			.post("/api/auth/sign-up/email")
			.set("Content-Type", "application/json")
			.send({
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			})
			.expect(200);

		expect(tracker.getCalls("after", "user", "create").length).toBe(before + 1);
	});

	it("should call @AfterCreate('session') on sign-up", async () => {
		const tracker = app.getContainer().resolve(DatabaseHookTrackerService);
		const before = tracker.getCalls("after", "session", "create").length;

		await request(hono)
			.post("/api/auth/sign-up/email")
			.set("Content-Type", "application/json")
			.send({
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			})
			.expect(200);

		expect(tracker.getCalls("after", "session", "create").length).toBe(
			before + 1,
		);
	});

	it("should support dependency injection in database hook providers", async () => {
		const tracker = app.getContainer().resolve(DatabaseHookTrackerService);
		expect(tracker).toBeInstanceOf(DatabaseHookTrackerService);

		const beforeCount = tracker.calls.length;

		await request(hono)
			.post("/api/auth/sign-up/email")
			.set("Content-Type", "application/json")
			.send({
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			})
			.expect(200);

		// DI works: tracker was injected and received calls
		expect(tracker.calls.length).toBeGreaterThan(beforeCount);
	});
});

describe("database hooks configuration validation", () => {
	it("should throw if database hook providers exist without databaseHooks configured", async () => {
		const auth = betterAuth({
			basePath: "/api/auth",
			emailAndPassword: { enabled: true },
			plugins: [bearer()],
			// intentionally DO NOT set databaseHooks: {}
		});

		await expect(
			createAuthTestApp(auth, {
				services: [DatabaseHookTrackerService, UserDatabaseHook],
			}),
		).rejects.toThrow(
			/@DatabaseHook providers.*databaseHooks.*not configured/i,
		);
	});
});
