import type { Auth } from "better-auth";

/**
 * Service that provides access to the Better Auth instance.
 * The BetterAuthPlugin registers it in the application's DI container, so it can be injected
 * into controllers and services by its class type.
 * Use generics to support auth instances extended by plugins.
 */
export class AuthService<T extends { api: T["api"] } = Auth> {
	readonly #auth: T | undefined;

	// The default keeps the constructor arity at 0, so a container without the plugin can still
	// create the service and the getters below report the missing plugin.
	constructor(auth: T | undefined = undefined) {
		this.#auth = auth;
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
		if (!this.#auth) {
			throw new Error(
				"AuthService has no Better Auth instance. Register the plugin: Application.create(AppModule, { plugins: [new BetterAuthPlugin({ auth })] }).",
			);
		}
		return this.#auth;
	}
}
