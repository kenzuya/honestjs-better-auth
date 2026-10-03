import type { Auth } from "better-auth";

// The auth instance lives outside the service so the plugin can bind it to a service that the DI
// container created before the plugin ran (for example for a global middleware).
const authInstances = new WeakMap<object, unknown>();

/**
 * Binds a Better Auth instance to a service. Used by the plugin; not exported from the package.
 */
export function bindAuthInstance(service: object, auth: unknown): void {
	authInstances.set(service, auth);
}

/**
 * Service that provides access to the Better Auth instance.
 * The BetterAuthPlugin registers it in the application's DI container, so it can be injected
 * into controllers and services by its class type.
 * Use generics to support auth instances extended by plugins.
 */
export class AuthService<T extends { api: T["api"] } = Auth> {
	// The default keeps the constructor arity at 0, so a container can create the service before the
	// plugin binds an instance to it, and the getters below report a missing plugin.
	constructor(auth: T | undefined = undefined) {
		if (auth) bindAuthInstance(this, auth);
	}

	/**
	 * Returns the API endpoints provided by the auth instance
	 */
	get api(): T["api"] {
		return this.instance.api;
	}

	/**
	 * Returns the complete auth instance
	 * Access this for plugin-specific functionality
	 */
	get instance(): T {
		const auth = authInstances.get(this) as T | undefined;
		if (!auth) {
			throw new Error(
				"AuthService has no Better Auth instance. Register the plugin: Application.create(AppModule, { plugins: [new BetterAuthPlugin({ auth })] }).",
			);
		}
		return auth;
	}
}
