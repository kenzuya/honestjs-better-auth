import "reflect-metadata";
import { beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { Service, type Application } from "@kenzuya/honest";
import type { Hono } from "hono";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { bearer } from "better-auth/plugins/bearer";
import {
	Hook,
	BeforeHook,
	AfterHook,
	type AuthHookContext,
} from "../../src/index.ts";
import request from "../shared/request.ts";
import { createAuthTestApp } from "../shared/test-utils.ts";

@Service()
class HookTrackerService {
	beforeCalls = 0;
	afterCalls = 0;

	markBefore() {
		this.beforeCalls += 1;
	}

	markAfter() {
		this.afterCalls += 1;
	}
}

@Hook()
@Service()
class SignUpBeforeHook {
	constructor(private readonly tracker: HookTrackerService) {}

	@BeforeHook("/sign-up/email")
	async handle(_ctx: AuthHookContext) {
		this.tracker.markBefore();
	}
}

@Hook()
@Service()
class SignUpAfterHook {
	constructor(private readonly tracker: HookTrackerService) {}

	@AfterHook("/sign-up/email")
	async handle(_ctx: AuthHookContext) {
		this.tracker.markAfter();
	}
}

@Hook()
@Service()
class ReturnValueHooks {
	@BeforeHook("/sign-up/email")
	async blockSignUp(ctx: AuthHookContext) {
		if (ctx.body?.name === "blocked") return ctx.json({ blocked: true });
	}

	@BeforeHook("/sign-up/email")
	async renameSignUp(ctx: AuthHookContext) {
		if (ctx.body?.name === "rename-me") {
			return { context: { body: { ...ctx.body, name: "Renamed" } } };
		}
	}

	@AfterHook("/ok")
	async replaceOk(ctx: AuthHookContext) {
		return ctx.json({ replaced: true });
	}
}

@Hook()
@Service()
class BaseSignUpHook {
	constructor(protected readonly tracker: HookTrackerService) {}

	@AfterHook("/sign-up/email")
	async handle(_ctx: AuthHookContext) {
		this.tracker.markAfter();
	}
}

@Service()
class InheritedSignUpHook extends BaseSignUpHook {}

type BetterAuthOptions = Parameters<typeof betterAuth>[0];

function createHookTestAuth(options?: Partial<BetterAuthOptions>) {
	return betterAuth({
		basePath: "/api/auth",
		emailAndPassword: { enabled: true },
		plugins: [bearer()],
		...options,
	});
}

function signUpBody(name = faker.person.fullName()) {
	return {
		name,
		email: faker.internet.email(),
		password: faker.internet.password({ length: 10 }),
	};
}

describe("hooks e2e", () => {
	let app: Application;
	let hono: Hono;

	beforeAll(async () => {
		const auth = betterAuth({
			basePath: "/api/auth",
			emailAndPassword: { enabled: true },
			plugins: [bearer()],
			// ensure hooks object exists so module can extend it
			hooks: {},
		});

		({ app, hono } = await createAuthTestApp(auth, {
			services: [HookTrackerService, SignUpBeforeHook, SignUpAfterHook],
		}));
	});

	it("should call @BeforeHook on matching route", async () => {
		const email = faker.internet.email();
		const password = faker.internet.password({ length: 10 });
		const name = faker.person.fullName();

		const tracker = app.getContainer().resolve(HookTrackerService);
		expect(tracker.beforeCalls).toBe(0);

		await request(hono)
			.post("/api/auth/sign-up/email")
			.set("Content-Type", "application/json")
			.send({ name, email, password })
			.expect(200);

		expect(tracker.beforeCalls).toBe(1);
	});

	it("should call @AfterHook on matching route", async () => {
		const email = faker.internet.email();
		const password = faker.internet.password({ length: 10 });
		const name = faker.person.fullName();

		const tracker = app.getContainer().resolve(HookTrackerService);
		const before = tracker.afterCalls;

		await request(hono)
			.post("/api/auth/sign-up/email")
			.set("Content-Type", "application/json")
			.send({ name, email, password })
			.expect(200);

		expect(tracker.afterCalls).toBe(before + 1);
	});
});

describe("hooks without a 'hooks' option", () => {
	it("should run @Hook services when Better Auth 'hooks' is not configured", async () => {
		const auth = createHookTestAuth();
		const { app, hono } = await createAuthTestApp(auth, {
			services: [HookTrackerService, SignUpBeforeHook],
		});

		await request(hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody())
			.expect(200);

		expect(app.getContainer().resolve(HookTrackerService).beforeCalls).toBe(1);
	});
});

describe("hook return values", () => {
	it("should respond with the value a @BeforeHook returns instead of running the endpoint", async () => {
		const auth = createHookTestAuth();
		const { hono } = await createAuthTestApp(auth, {
			services: [ReturnValueHooks],
		});
		const body = signUpBody("blocked");

		const response = await request(hono)
			.post("/api/auth/sign-up/email")
			.send(body)
			.expect(200);

		expect(response.body).toEqual({ blocked: true });
		const ctx = await auth.$context;
		expect(await ctx.internalAdapter.findUserByEmail(body.email)).toBeNull();
	});

	it("should apply the context a @BeforeHook returns", async () => {
		const auth = createHookTestAuth();
		const { hono } = await createAuthTestApp(auth, {
			services: [ReturnValueHooks],
		});

		const response = await request(hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody("rename-me"))
			.expect(200);

		expect(response.body.user.name).toBe("Renamed");
	});

	it("should replace the response with the value an @AfterHook returns", async () => {
		const auth = createHookTestAuth();
		const { hono } = await createAuthTestApp(auth, {
			services: [ReturnValueHooks],
		});

		const response = await request(hono).get("/api/auth/ok").expect(200);

		expect(response.body).toEqual({ replaced: true });
	});
});

describe("hooks alongside Better Auth's 'hooks' option", () => {
	it("should run both the configured hook and @Hook services", async () => {
		let userHookCalls = 0;
		const auth = createHookTestAuth({
			hooks: {
				before: createAuthMiddleware(async () => {
					userHookCalls += 1;
				}),
			},
		});
		const { app, hono } = await createAuthTestApp(auth, {
			services: [HookTrackerService, SignUpBeforeHook],
		});

		await request(hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody())
			.expect(200);

		expect(userHookCalls).toBe(1);
		expect(app.getContainer().resolve(HookTrackerService).beforeCalls).toBe(1);
	});

	it("should keep the response of a configured hook that returns early", async () => {
		const auth = createHookTestAuth({
			hooks: {
				before: createAuthMiddleware(async (ctx) => {
					if (ctx.path === "/sign-up/email")
						return ctx.json({ fromUser: true });
				}),
			},
		});
		const { app, hono } = await createAuthTestApp(auth, {
			services: [HookTrackerService, SignUpBeforeHook],
		});

		const response = await request(hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody())
			.expect(200);

		expect(response.body).toEqual({ fromUser: true });
		expect(app.getContainer().resolve(HookTrackerService).beforeCalls).toBe(0);
	});
});

describe("hooks on a shared Better Auth instance", () => {
	it("should run the hooks of the latest application once instead of stacking them", async () => {
		const auth = createHookTestAuth();
		const first = await createAuthTestApp(auth, {
			services: [HookTrackerService, SignUpAfterHook],
		});
		const second = await createAuthTestApp(auth, {
			services: [HookTrackerService, SignUpAfterHook],
		});
		const firstTracker = first.app.getContainer().resolve(HookTrackerService);
		const secondTracker = second.app.getContainer().resolve(HookTrackerService);

		await request(second.hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody())
			.expect(200);
		await request(first.hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody())
			.expect(200);

		expect(firstTracker.afterCalls).toBe(0);
		expect(secondTracker.afterCalls).toBe(2);
	});
});

describe("inherited hooks", () => {
	it("should wire a service that inherits @Hook() and its hook methods", async () => {
		const auth = createHookTestAuth();
		const { app, hono } = await createAuthTestApp(auth, {
			services: [HookTrackerService, InheritedSignUpHook],
		});

		await request(hono)
			.post("/api/auth/sign-up/email")
			.send(signUpBody())
			.expect(200);

		expect(app.getContainer().resolve(HookTrackerService).afterCalls).toBe(1);
	});
});
