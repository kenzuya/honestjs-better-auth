import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import {
	Controller,
	Get,
	NoopLogger,
	Service,
	UseGuards,
	createTestApplication,
} from "@kenzuya/honest";
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
});
