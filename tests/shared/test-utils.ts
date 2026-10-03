import "reflect-metadata";
import {
	type HonestOptions,
	NoopLogger,
	createTestApplication,
} from "@kenzuya/honest";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { bearer } from "better-auth/plugins/bearer";
import {
	AuthGuard,
	BetterAuthPlugin,
	type BetterAuthPluginOptions,
} from "../../src/index.ts";
import { ActiveOrgController, TestController } from "./test-controller.ts";

type BetterAuthOptions = Parameters<typeof betterAuth>[0];
// biome-ignore lint/suspicious/noExplicitAny: test modules can list any class
type Constructor = new (...args: any[]) => unknown;

export type TestPluginOptions = Omit<BetterAuthPluginOptions, "auth">;

// Create Better Auth instance factory
export function createTestAuth(authOptions?: Partial<BetterAuthOptions>) {
	return betterAuth({
		basePath: "/api/auth",
		emailAndPassword: {
			enabled: true,
		},
		plugins: [
			bearer(),
			admin({
				roles: {
					admin: adminAc,
					moderator: userAc, // moderator has same permissions as user but is a different custom role
					user: userAc,
				},
			}),
		],
		...authOptions,
	});
}

export interface AuthTestAppOptions {
	module?: Constructor;
	controllers?: Constructor[];
	services?: Constructor[];
	pluginOptions?: TestPluginOptions;
	/**
	 * Register AuthGuard as a global guard (default true).
	 */
	globalGuard?: boolean;
	appOptions?: HonestOptions;
}

/**
 * Creates a Honest test application with the BetterAuthPlugin and, by default, a global AuthGuard.
 */
export async function createAuthTestApp(
	auth: unknown,
	options: AuthTestAppOptions = {},
) {
	const { appOptions = {}, globalGuard = true } = options;

	return createTestApplication({
		module: options.module,
		controllers: options.controllers,
		services: options.services,
		appOptions: {
			logger: new NoopLogger(),
			...appOptions,
			plugins: [
				new BetterAuthPlugin({ auth, ...options.pluginOptions }),
				...(appOptions.plugins ?? []),
			],
			components: {
				...appOptions.components,
				guards: [
					...(globalGuard ? [AuthGuard] : []),
					...(appOptions.components?.guards ?? []),
				],
			},
		},
	});
}

export interface TestAppOptions {
	globalPrefix?: string;
	authOptions?: Partial<BetterAuthOptions>;
	appOptions?: HonestOptions;
}

export async function createTestApp(
	options?: TestPluginOptions,
	appOptions?: TestAppOptions,
) {
	const auth = createTestAuth(appOptions?.authOptions);

	const testApp = await createAuthTestApp(auth, {
		controllers: [TestController, ActiveOrgController],
		pluginOptions: options,
		appOptions: {
			...appOptions?.appOptions,
			...(appOptions?.globalPrefix && {
				routing: { prefix: appOptions.globalPrefix },
			}),
		},
	});

	return { ...testApp, auth };
}

export type TestAppSetup = Awaited<ReturnType<typeof createTestApp>>;
