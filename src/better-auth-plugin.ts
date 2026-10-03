import {
	type Application,
	type ILogger,
	type IPlugin,
	normalizePath,
} from "@kenzuya/honest";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { cloneRawRequest } from "hono/request";
import { AuthGuard, getAuthGuardService } from "./auth-guard.ts";
import { AuthService, bindAuthInstance } from "./auth-service.ts";
import { type BetterAuthContext, registerHooks } from "./hooks.ts";

// biome-ignore lint/suspicious/noExplicitAny: i don't want to cause issues/breaking changes between different ways of setting up better-auth and even versions
export type Auth = any;

export type BetterAuthPluginOptions<A = Auth> = {
	auth: A;
	/**
	 * Do not add the CORS middleware that allows the origins Better Auth trusts on its routes.
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

/**
 * Returns the path Better Auth routes on: the path of its base URL when `baseURL` (or
 * `BETTER_AUTH_URL`) has one, and `basePath` otherwise.
 */
function getBasePath(ctx: BetterAuthContext): string {
	if (ctx.baseURL) {
		try {
			return normalizePath(new URL(ctx.baseURL).pathname);
		} catch {
			// Fall back to basePath below
		}
	}
	return normalizePath(ctx.options.basePath || "/api/auth");
}

/**
 * Honest plugin that integrates Better Auth.
 *
 * - Registers `AuthService` and `AuthGuard` in the application's DI container.
 * - Mounts Better Auth's handler on its base path (default `/api/auth`). The global routing
 *   prefix and version do not apply to it.
 * - Allows the origins Better Auth trusts through CORS on those routes.
 * - Wires `@Hook()` and `@DatabaseHook()` services into Better Auth's hooks.
 *
 * The plugin does not guard your routes by itself: add `components: { guards: [AuthGuard] }` to
 * the application options, or use `@UseGuards(AuthGuard)` on controllers or routes.
 */
export class BetterAuthPlugin implements IPlugin {
	readonly meta = { name: "better-auth" };
	logger?: ILogger;

	constructor(private readonly options: BetterAuthPluginOptions) {
		if (!options?.auth) {
			throw new Error(
				"BetterAuthPlugin requires a Better Auth instance: new BetterAuthPlugin({ auth }).",
			);
		}
	}

	async beforeModulesRegistered(app: Application, hono: Hono): Promise<void> {
		this.registerServices(app);

		if (this.options.disableControllers) return;

		const ctx = await this.getAuthContext();
		const basePath = getBasePath(ctx);
		// A root base path would shadow every controller route, so it is mounted after them instead
		if (basePath !== "/") this.mount(hono, ctx, basePath);
	}

	async afterModulesRegistered(app: Application, hono: Hono): Promise<void> {
		const ctx = await this.getAuthContext();
		registerHooks(ctx, app.getContainer());

		if (!this.options.disableControllers && getBasePath(ctx) === "/") {
			this.mount(hono, ctx, "/");
		}
	}

	private getAuthContext(): Promise<BetterAuthContext> {
		return this.options.auth.$context;
	}

	/**
	 * Binds the auth instance to the container's AuthService and AuthGuard, reusing instances the
	 * container created before the plugin ran so whatever already holds them sees the auth instance.
	 */
	private registerServices(app: Application): void {
		const container = app.getContainer();
		const { auth } = this.options;

		let authService: AuthService<Auth>;
		if (container.has(AuthService)) {
			authService = container.resolve(AuthService);
		} else {
			authService = new AuthService<Auth>();
			container.register(AuthService, authService);
		}
		bindAuthInstance(authService, auth);

		if (container.has(AuthGuard)) {
			bindAuthInstance(getAuthGuardService(container.resolve(AuthGuard)), auth);
		} else {
			container.register(AuthGuard, new AuthGuard(authService));
		}
	}

	private mount(hono: Hono, ctx: BetterAuthContext, basePath: string): void {
		// Hono's "/path/*" also matches "/path" itself
		const route = basePath === "/" ? "/*" : `${basePath}/*`;

		if (!this.options.disableTrustedOriginsCors) {
			hono.use(route, this.createTrustedOriginsCors(ctx));
		}

		const handler = async (c: Context) => {
			// A middleware that read the body through Hono consumed the raw request; rebuild it from Hono's cache
			const request = c.req.raw.bodyUsed
				? await cloneRawRequest(c.req)
				: c.req.raw;
			return this.options.auth.handler(request);
		};

		if (this.options.middleware) {
			hono.all(route, this.options.middleware, handler);
		} else {
			hono.all(route, handler);
		}

		this.logger?.emit({
			level: "info",
			category: "plugins",
			message: `BetterAuthPlugin mounted Better Auth on '${basePath}'`,
		});
	}

	/**
	 * Allows the origins Better Auth trusts, matched by Better Auth itself so wildcard and custom
	 * scheme patterns work. Like Better Auth's own origin check, a `trustedOrigins` function is
	 * called with the request on top of the origins resolved at startup.
	 */
	private createTrustedOriginsCors(ctx: BetterAuthContext): MiddlewareHandler {
		return cors({
			origin: async (origin, c) => {
				if (!origin) return null;

				const trustedOrigins = ctx.options.trustedOrigins;
				const origins =
					typeof trustedOrigins === "function"
						? [
								...ctx.trustedOrigins,
								...((await trustedOrigins(c.req.raw)) ?? []).filter(
									(value): value is string => Boolean(value),
								),
							]
						: ctx.trustedOrigins;

				return ctx.isTrustedOrigin.call({ trustedOrigins: origins }, origin)
					? origin
					: null;
			},
			allowMethods: ["GET", "POST", "PUT", "DELETE"],
			credentials: true,
		});
	}
}
