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

@Service()
class UserNameLog {
	names: string[] = [];
}

@DatabaseHook()
@Service()
class AbortUserHook {
	@BeforeCreate("user")
	async beforeCreate(user: { name: string }) {
		if (user.name === "abort") return false;
	}
}

@DatabaseHook()
@Service()
class FirstUserNameHook {
	@BeforeCreate("user")
	async beforeCreate(user: { name: string }) {
		return { data: { name: `${user.name} first` } };
	}
}

@DatabaseHook()
@Service()
class SecondUserNameHook {
	constructor(private readonly log: UserNameLog) {}

	@BeforeCreate("user")
	async beforeCreate(user: { name: string }) {
		this.log.names.push(user.name);
		return { data: { name: `${user.name} second` } };
	}
}

type BetterAuthOptions = Parameters<typeof betterAuth>[0];

function createDatabaseHookTestAuth(
	databaseHooks: BetterAuthOptions["databaseHooks"] = {},
) {
	return betterAuth({
		basePath: "/api/auth",
		emailAndPassword: { enabled: true },
		plugins: [bearer()],
		databaseHooks,
	});
}

function signUpBody(name = faker.person.fullName()) {
	return {
		name,
		email: faker.internet.email(),
		password: faker.internet.password({ length: 10 }),
	};
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

describe("database hook chaining", () => {
	it("should abort when the configured before hook returns false, even with @BeforeCreate services", async () => {
		const auth = createDatabaseHookTestAuth({
			user: {
				create: {
					before: async (user) => {
						if (user.name === "deny") return false;
					},
				},
			},
		});
		const { hono } = await createAuthTestApp(auth, {
			services: [FirstUserNameHook],
		});
		const denied = signUpBody("deny");

		const response = await request(hono)
			.post("/api/auth/sign-up/email")
			.send(denied);

		expect(response.status).toBe(400);
		expect(response.body.code).toBe("FAILED_TO_CREATE_USER");
		const ctx = await auth.$context;
		expect(await ctx.internalAdapter.findUserByEmail(denied.email)).toBeNull();

		const allowed = await request(hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody("Ada"))
			.expect(200);
		expect(allowed.body.user.name).toBe("Ada first");
	});

	it("should pass the data a @BeforeCreate service returns on to the next one", async () => {
		const auth = createDatabaseHookTestAuth();
		const { app, hono } = await createAuthTestApp(auth, {
			services: [UserNameLog, FirstUserNameHook, SecondUserNameHook],
		});

		const response = await request(hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody("Ada"))
			.expect(200);

		expect(response.body.user.name).toBe("Ada first second");
		expect(app.getContainer().resolve(UserNameLog).names).toEqual([
			"Ada first",
		]);
	});

	it("should abort when a @BeforeCreate service returns false", async () => {
		const auth = createDatabaseHookTestAuth();
		const { app, hono } = await createAuthTestApp(auth, {
			services: [UserNameLog, AbortUserHook, SecondUserNameHook],
		});
		const body = signUpBody("abort");

		const response = await request(hono)
			.post("/api/auth/sign-up/email")
			.send(body);

		expect(response.status).toBe(400);
		expect(response.body.code).toBe("FAILED_TO_CREATE_USER");
		const ctx = await auth.$context;
		expect(await ctx.internalAdapter.findUserByEmail(body.email)).toBeNull();
		expect(app.getContainer().resolve(UserNameLog).names).toEqual([]);
	});
});

describe("database hooks on a shared Better Auth instance", () => {
	it("should run the hooks of the latest application once instead of stacking them", async () => {
		const auth = createDatabaseHookTestAuth();
		const first = await createAuthTestApp(auth, {
			services: [DatabaseHookTrackerService, UserDatabaseHook],
		});
		const second = await createAuthTestApp(auth, {
			services: [DatabaseHookTrackerService, UserDatabaseHook],
		});

		await request(second.hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody())
			.expect(200);

		const firstTracker = first.app
			.getContainer()
			.resolve(DatabaseHookTrackerService);
		const secondTracker = second.app
			.getContainer()
			.resolve(DatabaseHookTrackerService);
		expect(firstTracker.getCalls("before", "user", "create")).toHaveLength(0);
		expect(secondTracker.getCalls("before", "user", "create")).toHaveLength(1);
		expect(secondTracker.getCalls("after", "user", "create")).toHaveLength(1);
	});
});
