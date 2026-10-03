import "reflect-metadata";
import { beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { Service, type Application } from "@kenzuya/honest";
import type { Hono } from "hono";
import { betterAuth } from "better-auth";
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

describe("hooks configuration validation", () => {
	it("should throw if hook providers exist without hooks configured", async () => {
		const auth = betterAuth({
			basePath: "/api/auth",
			emailAndPassword: { enabled: true },
			plugins: [bearer()],
			// intentionally DO NOT set hooks: {}
		});

		await expect(
			createAuthTestApp(auth, {
				services: [HookTrackerService, SignUpBeforeHook],
			}),
		).rejects.toThrow(/@Hook providers.*hooks.*not configured/i);
	});
});
