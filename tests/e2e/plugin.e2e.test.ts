import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import {
	Controller,
	Get,
	type IMiddleware,
	type IPlugin,
	NoopLogger,
	Service,
	UseGuards,
	createTestApplication,
} from "@kenzuya/honest";
import type { Context, Next } from "hono";
import {
	AllowAnonymous,
	AuthGuard,
	AuthService,
	BetterAuthPlugin,
	Session,
	type UserSession,
} from "../../src/index.ts";
import request from "../shared/request.ts";
import { createAuthTestApp, createTestAuth } from "../shared/test-utils.ts";

type TestAuth = ReturnType<typeof createTestAuth>;

@Service()
class ProfileService {
	constructor(private readonly authService: AuthService<TestAuth>) {}

	get auth() {
		return this.authService.instance;
	}
}

@Controller("profile")
class ProfileController {
	constructor(private readonly profileService: ProfileService) {}

	@Get("me")
	me(@Session() session: UserSession) {
		return { userId: session.user.id };
	}

	@AllowAnonymous()
	@Get("has-auth")
	hasAuth() {
		return { hasAuth: typeof this.profileService.auth.handler === "function" };
	}
}

@UseGuards(AuthGuard)
@Controller("guarded")
class GuardedController {
	@Get()
	guarded(@Session() session: UserSession) {
		return { userId: session.user.id };
	}
}

@Controller("unguarded")
class UnguardedController {
	@Get()
	unguarded(@Session() session: UserSession | undefined) {
		return { hasSession: session !== undefined };
	}
}

// Global middleware is resolved when the application is constructed, before plugins run
@Service()
class SessionHeaderMiddleware implements IMiddleware {
	constructor(private readonly authService: AuthService<TestAuth>) {}

	async use(c: Context, next: Next) {
		const session = await this.authService.api.getSession({
			headers: c.req.raw.headers,
		});
		await next();
		c.res.headers.set("x-has-session", String(Boolean(session)));
	}
}

// Resolves AuthGuard from the container before the BetterAuthPlugin runs and keeps it
class EarlyGuardPlugin implements IPlugin {
	guard?: AuthGuard;

	beforeModulesRegistered: IPlugin["beforeModulesRegistered"] = (app) => {
		this.guard = app.getContainer().resolve(AuthGuard);
	};
}

describe("plugin e2e", () => {
	it("should register AuthService so services and controllers can inject it", async () => {
		const auth = createTestAuth();
		const { app, hono } = await createAuthTestApp(auth, {
			controllers: [ProfileController],
			services: [ProfileService],
		});

		expect(app.getContainer().resolve(AuthService).instance).toBe(auth);
		expect(app.getContainer().resolve(ProfileService).auth).toBe(auth);

		const response = await request(hono).get("/profile/has-auth").expect(200);
		expect(response.body).toEqual({ hasAuth: true });
	});

	it("should guard routes with @UseGuards(AuthGuard) without a global guard", async () => {
		const auth = createTestAuth();
		const { hono } = await createAuthTestApp(auth, {
			controllers: [GuardedController, UnguardedController],
			globalGuard: false,
		});

		const signUp = await auth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			},
		});

		await request(hono).get("/guarded").expect(401);

		const guarded = await request(hono)
			.get("/guarded")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);
		expect(guarded.body).toEqual({ userId: signUp.user.id });

		const unguarded = await request(hono).get("/unguarded").expect(200);
		expect(unguarded.body).toEqual({ hasSession: false });
	});

	it("should not apply the routing prefix or version to Better Auth routes", async () => {
		const auth = createTestAuth();
		const { hono } = await createAuthTestApp(auth, {
			controllers: [ProfileController],
			services: [ProfileService],
			appOptions: { routing: { prefix: "api", version: 1 } },
		});

		await request(hono).get("/api/auth/ok").expect(200);
		await request(hono).get("/api/v1/profile/has-auth").expect(200);
	});

	it("should isolate applications that use different auth instances", async () => {
		const firstAuth = createTestAuth();
		const secondAuth = createTestAuth();
		const first = await createAuthTestApp(firstAuth, {
			controllers: [ProfileController],
			services: [ProfileService],
		});
		const second = await createAuthTestApp(secondAuth, {
			controllers: [ProfileController],
			services: [ProfileService],
		});

		const signUp = await firstAuth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			},
		});

		await request(first.hono)
			.get("/profile/me")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);
		await request(second.hono)
			.get("/profile/me")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(401);
	});

	it("should require an auth instance", () => {
		expect(
			() => new BetterAuthPlugin({ auth: undefined as unknown as TestAuth }),
		).toThrow(/requires a Better Auth instance/);
	});

	it("should report a missing plugin when AuthGuard is used without it", async () => {
		const { hono } = await createTestApplication({
			controllers: [GuardedController],
			appOptions: { logger: new NoopLogger() },
		});

		const response = await request(hono).get("/guarded").expect(500);
		expect(response.body.message).toMatch(/BetterAuthPlugin/);
	});

	it("should bind the auth instance to an AuthService resolved before the plugin ran", async () => {
		const auth = createTestAuth();
		const { hono } = await createAuthTestApp(auth, {
			controllers: [ProfileController],
			services: [ProfileService],
			appOptions: { components: { middleware: [SessionHeaderMiddleware] } },
		});
		const signUp = await auth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			},
		});

		const anonymous = await request(hono).get("/profile/has-auth").expect(200);
		expect(anonymous.headers["x-has-session"]).toBe("false");

		const signedIn = await request(hono)
			.get("/profile/me")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);
		expect(signedIn.headers["x-has-session"]).toBe("true");
	});

	it("should bind the auth instance to an AuthGuard resolved before the plugin ran", async () => {
		const auth = createTestAuth();
		const earlyGuardPlugin = new EarlyGuardPlugin();
		const { app, hono } = await createTestApplication({
			controllers: [GuardedController],
			appOptions: {
				logger: new NoopLogger(),
				plugins: [earlyGuardPlugin, new BetterAuthPlugin({ auth })],
			},
		});

		// The guard created early is the one requests use, so whatever holds it keeps working
		expect(earlyGuardPlugin.guard).toBeInstanceOf(AuthGuard);
		expect(app.getContainer().resolve(AuthGuard)).toBe(
			earlyGuardPlugin.guard as AuthGuard,
		);
		const signUp = await auth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
			},
		});

		const response = await request(hono)
			.get("/guarded")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);
		expect(response.body).toEqual({ userId: signUp.user.id });
	});
});
