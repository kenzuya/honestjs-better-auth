import {
	type Application,
	type ILogger,
	type IPlugin,
	normalizePath,
} from "@kenzuya/honest";
import { createAuthMiddleware } from "better-auth/api";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { AuthGuard } from "./auth-guard.ts";
import { AuthService } from "./auth-service.ts";
import type { DatabaseHookModel, DatabaseHookOperation } from "./decorators.ts";
import { getAllMethodNames, getHookProviders } from "./metadata.ts";
import {
	AFTER_DATABASE_HOOK_KEY,
	AFTER_HOOK_KEY,
	BEFORE_DATABASE_HOOK_KEY,
	BEFORE_HOOK_KEY,
	DATABASE_HOOK_KEY,
	HOOK_KEY,
} from "./symbols.ts";

const HOOKS = [
	{ metadataKey: BEFORE_HOOK_KEY, hookType: "before" as const },
	{ metadataKey: AFTER_HOOK_KEY, hookType: "after" as const },
];

const DATABASE_HOOKS = [
	{ metadataKey: BEFORE_DATABASE_HOOK_KEY, hookType: "before" as const },
	{ metadataKey: AFTER_DATABASE_HOOK_KEY, hookType: "after" as const },
];

// biome-ignore lint/suspicious/noExplicitAny: i don't want to cause issues/breaking changes between different ways of setting up better-auth and even versions
export type Auth = any;

export type BetterAuthPluginOptions<A = Auth> = {
	auth: A;
	/**
	 * Do not add the CORS middleware that allows Better Auth's `trustedOrigins` on its routes.
	 */
	disableTrustedOriginsCors?: boolean;
	/**
	 * Do not mount Better Auth's route handler (or its CORS middleware).
	 * `AuthService`, `AuthGuard` and hooks keep working.
	 */
	disableControllers?: boolean;
	/**
	 * Hono middleware that runs before Better Auth's handler on its routes.
	 */
	middleware?: MiddlewareHandler;
};

type HookProvider = { new (...args: unknown[]): unknown };

/**
 * Honest plugin that integrates Better Auth.
 *
 * - Registers `AuthService` and `AuthGuard` in the application's DI container.
 * - Mounts Better Auth's handler on its `basePath` (default `/api/auth`). The global routing
 *   prefix and version do not apply to it.
 * - Allows the `trustedOrigins` from the Better Auth options through CORS on those routes.
 * - Wires `@Hook()` and `@DatabaseHook()` services into Better Auth's hooks.
 *
 * The plugin does not guard your routes by itself: add `components: { guards: [AuthGuard] }` to
 * the application options, or use `@UseGuards(AuthGuard)` on controllers or routes.
 */
export class BetterAuthPlugin implements IPlugin {
	readonly meta = { name: "better-auth" };
	logger?: ILogger;
	private readonly basePath: string;

	constructor(private readonly options: BetterAuthPluginOptions) {
		if (!options?.auth) {
			throw new Error(
				"BetterAuthPlugin requires a Better Auth instance: new BetterAuthPlugin({ auth }).",
			);
		}

		// Get basePath from options or use default
		// - Ensure basePath starts with /
		// - Ensure basePath doesn't end with /
		this.basePath = normalizePath(
			options.auth.options?.basePath ?? "/api/auth",
		);

		const trustedOrigins = options.auth.options?.trustedOrigins;
		if (
			trustedOrigins &&
			!Array.isArray(trustedOrigins) &&
			typeof trustedOrigins !== "function"
		) {
			throw new Error(
				"Better Auth 'trustedOrigins' must be an array of origins or a function returning one.",
			);
		}
	}

	beforeModulesRegistered(app: Application, hono: Hono): void {
		const container = app.getContainer();
		const authService = new AuthService(this.options.auth);
		container.register(AuthService, authService);
		container.register(AuthGuard, new AuthGuard(authService));

		if (this.options.disableControllers) return;

		// Hono's "/path/*" also matches "/path" itself
		const route = this.basePath === "/" ? "/*" : `${this.basePath}/*`;

		const corsMiddleware = this.createTrustedOriginsCors();
		if (corsMiddleware) {
			hono.use(route, corsMiddleware);
		}

		const handler = (c: Context) => this.options.auth.handler(c.req.raw);
		if (this.options.middleware) {
			hono.all(route, this.options.middleware, handler);
		} else {
			hono.all(route, handler);
		}

		this.logger?.emit({
			level: "info",
			category: "plugins",
			message: `BetterAuthPlugin mounted Better Auth on '${this.basePath}'`,
		});
	}

	afterModulesRegistered(app: Application): void {
		const container = app.getContainer();
		const providers = [...getHookProviders()].filter((provider) =>
			container.has(provider),
		);

		const hookProviders = providers.filter((provider) =>
			Reflect.getMetadata(HOOK_KEY, provider),
		);

		const hasHookProviders = hookProviders.length > 0;
		const hooksConfigured =
			typeof this.options.auth?.options?.hooks === "object";

		if (hasHookProviders && !hooksConfigured)
			throw new Error(
				"Detected @Hook providers but Better Auth 'hooks' are not configured. Add 'hooks: {}' to your betterAuth(...) options.",
			);

		if (hooksConfigured) {
			for (const provider of hookProviders) {
				const instance = container.resolve(provider) as HookProvider;
				const providerPrototype = Object.getPrototypeOf(instance);

				for (const method of getAllMethodNames(providerPrototype)) {
					const providerMethod = providerPrototype[method];
					this.setupHooks(providerMethod, instance);
				}
			}
		}

		// Database hooks discovery
		const databaseHookProviders = providers.filter((provider) =>
			Reflect.getMetadata(DATABASE_HOOK_KEY, provider),
		);

		const hasDatabaseHookProviders = databaseHookProviders.length > 0;
		const databaseHooksConfigured =
			typeof this.options.auth?.options?.databaseHooks === "object";

		if (hasDatabaseHookProviders && !databaseHooksConfigured)
			throw new Error(
				"Detected @DatabaseHook providers but Better Auth 'databaseHooks' is not configured. Add an empty 'databaseHooks: {}' object to your betterAuth(...) options.",
			);

		for (const provider of databaseHookProviders) {
			const instance = container.resolve(provider) as HookProvider;
			const providerPrototype = Object.getPrototypeOf(instance);

			for (const method of getAllMethodNames(providerPrototype)) {
				const providerMethod = providerPrototype[method];
				this.setupDatabaseHooks(providerMethod, instance);
			}
		}
	}

	/**
	 * Allows Better Auth's `trustedOrigins` on its routes. A function is called with the request.
	 */
	private createTrustedOriginsCors(): MiddlewareHandler | undefined {
		const trustedOrigins = this.options.auth.options?.trustedOrigins;
		if (this.options.disableTrustedOriginsCors || !trustedOrigins) {
			return undefined;
		}

		return cors({
			origin: async (origin, c) => {
				const origins: unknown[] =
					typeof trustedOrigins === "function"
						? ((await trustedOrigins(c.req.raw)) ?? [])
						: trustedOrigins;
				return origins.includes(origin) ? origin : null;
			},
			allowMethods: ["GET", "POST", "PUT", "DELETE"],
			credentials: true,
		});
	}

	private setupHooks(
		providerMethod: (...args: unknown[]) => unknown,
		providerClass: HookProvider,
	) {
		if (!this.options.auth.options.hooks) return;

		for (const { metadataKey, hookType } of HOOKS) {
			const hasHook = Reflect.hasMetadata(metadataKey, providerMethod);
			if (!hasHook) continue;

			const hookPath = Reflect.getMetadata(metadataKey, providerMethod);

			const originalHook = this.options.auth.options.hooks[hookType];
			this.options.auth.options.hooks[hookType] = createAuthMiddleware(
				async (ctx) => {
					if (originalHook) {
						await originalHook(ctx);
					}

					if (hookPath && hookPath !== ctx.path) return;

					await providerMethod.apply(providerClass, [ctx]);
				},
			);
		}
	}

	private setupDatabaseHooks(
		providerMethod: (...args: unknown[]) => unknown,
		providerClass: HookProvider,
	) {
		if (!this.options.auth.options.databaseHooks) return;

		for (const { metadataKey, hookType } of DATABASE_HOOKS) {
			if (!Reflect.hasMetadata(metadataKey, providerMethod)) continue;

			const { model, operation } = Reflect.getMetadata(
				metadataKey,
				providerMethod,
			) as { model: DatabaseHookModel; operation: DatabaseHookOperation };

			const databaseHooks = this.options.auth.options.databaseHooks;

			// Ensure the nested structure exists: databaseHooks[model][operation]
			databaseHooks[model] ??= {};
			databaseHooks[model][operation] ??= {};

			const originalHook = databaseHooks[model][operation][hookType];
			databaseHooks[model][operation][hookType] = async (
				...args: unknown[]
			) => {
				if (originalHook) {
					await originalHook(...args);
				}
				return providerMethod.apply(providerClass, args);
			};
		}
	}
}
