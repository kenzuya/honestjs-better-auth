import { beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { Controller, Get, Req } from "@kenzuya/honest";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { username } from "better-auth/plugins/username";
import { admin } from "better-auth/plugins/admin";
import type { Hono, HonoRequest } from "hono";
import { Session } from "../../src/decorators.ts";
import { AuthService } from "../../src/index.ts";
import type { UserSession } from "../../src/auth-guard.ts";
import request from "../shared/request.ts";
import { createAuthTestApp } from "../shared/test-utils.ts";

function createAuthWithUsername() {
	return betterAuth({
		basePath: "/api/auth",
		emailAndPassword: { enabled: true },
		plugins: [bearer(), username(), admin()],
	});
}

type AuthWithUsername = ReturnType<typeof createAuthWithUsername>;

@Controller("session-test")
class SessionTestController {
	constructor(private readonly authService: AuthService<AuthWithUsername>) {}

	@Get("session")
	getSession(@Session() session: UserSession<AuthWithUsername>) {
		return {
			user: session?.user,
			session: session?.session,
		};
	}

	@Get("compare")
	async compareSessionSources(
		@Session() session: UserSession<AuthWithUsername>,
		@Req() req: HonoRequest,
	) {
		const apiSession = await this.authService.api.getSession({
			headers: req.raw.headers,
		});

		return {
			decorator: {
				username: session?.user?.username ?? null,
				displayUsername: session?.user?.displayUsername ?? null,
			},
			api: {
				username: apiSession?.user?.username ?? null,
				displayUsername: apiSession?.user?.displayUsername ?? null,
			},
		};
	}
}

describe("session custom fields e2e", () => {
	let hono: Hono;
	let auth: AuthWithUsername;

	beforeAll(async () => {
		auth = createAuthWithUsername();

		({ hono } = await createAuthTestApp(auth, {
			controllers: [SessionTestController],
		}));
	});

	it("should include username plugin fields in @Session() output", async () => {
		const testUsername = `user_${faker.string.alphanumeric(8)}`;

		const signUp = await auth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
				username: testUsername,
			},
		});

		const response = await request(hono)
			.get("/session-test/session")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);

		expect(response.body.user).toHaveProperty("username");
		expect(response.body.user.username).toBe(testUsername.toLowerCase());
		expect(response.body.user).toHaveProperty("id");
		expect(response.body.user).toHaveProperty("name");
		expect(response.body.user).toHaveProperty("email");
	});

	it("should include displayUsername plugin field in @Session() output", async () => {
		const testUsername = `user_${faker.string.alphanumeric(8)}`;
		const testDisplayUsername = `Display_${faker.string.alphanumeric(5)}`;

		const signUp = await auth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
				username: testUsername,
				displayUsername: testDisplayUsername,
			},
		});

		const response = await request(hono)
			.get("/session-test/session")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);

		expect(response.body.user).toHaveProperty("displayUsername");
		expect(response.body.user.displayUsername).toBe(testDisplayUsername);
	});

	it("should return identical plugin fields from @Session() and authService.api.getSession()", async () => {
		const testUsername = `user_${faker.string.alphanumeric(8)}`;
		const testDisplayUsername = `Display_${faker.string.alphanumeric(5)}`;

		const signUp = await auth.api.signUpEmail({
			body: {
				name: faker.person.fullName(),
				email: faker.internet.email(),
				password: faker.internet.password({ length: 10 }),
				username: testUsername,
				displayUsername: testDisplayUsername,
			},
		});

		const response = await request(hono)
			.get("/session-test/compare")
			.set("Authorization", `Bearer ${signUp.token}`)
			.expect(200);

		expect(response.body.decorator.username).toBe(response.body.api.username);
		expect(response.body.decorator.displayUsername).toBe(
			response.body.api.displayUsername,
		);
		expect(response.body.decorator.username).toBe(testUsername.toLowerCase());
		expect(response.body.decorator.displayUsername).toBe(testDisplayUsername);
	});
});
